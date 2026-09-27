import { z } from 'zod';
import { User, Tenant, AuditLog } from '../../models/index.js';
import {
  STATUS,
  authorizeTargetAction,
  recordAudit,
  suspendUser,
  reactivateUser,
  revokeUserSessions,
  describeUserImpact,
  hardDeleteUser,
  cascadeTenant
} from '../../utils/accountLifecycle.js';

const idParam = z.string().uuid('Invalid account id.');
const reasonField = z.string().trim().max(500).optional();

// Deleting is irreversible here (hard delete), so the client must echo the
// target's mobile number back. This is the same shape as a "type the repo
// name to delete it" confirmation: it makes an accidental click on the wrong
// row in a long table impossible, and it cannot be satisfied by a replayed
// request against a different id.
const confirmField = z.string().trim().min(1, 'Confirmation is required.');

const notFound = (res) =>
  res.status(404).json({ error: { message: 'Account not found.', code: 'USER_NOT_FOUND' } });

const refuse = (res, refusal) =>
  res.status(refusal.status).json({ error: { message: refusal.message, code: refusal.code } });

/** Loads the target and applies the shared authorization rules. */
const loadTarget = async (req, res) => {
  const parsedId = idParam.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: { message: parsedId.error.errors[0].message, code: 'INVALID_ID' } });
    return null;
  }
  const target = await User.findByPk(parsedId.data);
  if (!target) {
    notFound(res);
    return null;
  }
  const refusal = authorizeTargetAction(req.user, req.userRole, target);
  if (refusal) {
    refuse(res, refusal);
    return null;
  }
  return target;
};

/** POST /admin/users/:id/suspend */
export const suspendAccount = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const { reason } = z.object({ reason: reasonField }).parse(req.body ?? {});
    if (target.status === STATUS.SUSPENDED) {
      return res.status(409).json({
        error: { message: 'This account is already suspended.', code: 'ALREADY_SUSPENDED' }
      });
    }

    const snapshot = await suspendUser(target);
    await recordAudit(req, {
      action: 'SUSPEND',
      targetType: 'USER',
      targetId: target.id,
      targetSnapshot: snapshot,
      reason
    });

    return res.status(200).json({
      message: 'Account suspended. All of its sessions have been signed out.',
      user: { id: target.id, status: target.status }
    });
  } catch (error) {
    next(error);
  }
};

/** POST /admin/users/:id/reactivate */
export const reactivateAccount = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    if (target.status !== STATUS.SUSPENDED) {
      return res.status(409).json({
        error: { message: 'This account is not suspended.', code: 'NOT_SUSPENDED' }
      });
    }

    const previous = target.status;
    const snapshot = await reactivateUser(target);
    await recordAudit(req, {
      action: 'REACTIVATE',
      targetType: 'USER',
      targetId: target.id,
      targetSnapshot: { ...snapshot, restoredFrom: previous }
    });

    return res.status(200).json({
      message: 'Account reactivated.',
      user: { id: target.id, status: target.status }
    });
  } catch (error) {
    next(error);
  }
};

/** POST /admin/users/:id/revoke-sessions */
export const revokeAccountSessions = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const { reason } = z.object({ reason: reasonField }).parse(req.body ?? {});
    const snapshot = await revokeUserSessions(target);
    await recordAudit(req, {
      action: 'REVOKE_SESSIONS',
      targetType: 'USER',
      targetId: target.id,
      targetSnapshot: snapshot,
      reason
    });

    return res.status(200).json({
      message: 'Signed out of all devices. The account can sign in again.',
      user: { id: target.id, status: target.status }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /admin/users/:id/impact — what a delete would take with it.
 * The web console calls this before showing the confirmation dialog so the
 * operator is told the blast radius instead of guessing at it.
 */
export const getAccountImpact = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const impact = await describeUserImpact(target);
    return res.status(200).json({
      user: {
        id: target.id,
        name: [target.firstName, target.lastName].filter(Boolean).join(' ') || null,
        mobileNumber: target.mobileNumber,
        role: target.role,
        status: target.status
      },
      impact,
      // Echoed so the UI shows exactly what the operator has to type.
      confirmationRequired: target.mobileNumber
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /admin/users/:id — permanent removal.
 *
 * Covers both "delete the account" and "delete the pending request": a
 * signup that was never approved is just a user row in PENDING_APPROVAL, and
 * removing it goes down exactly the same path. The action is recorded as
 * DELETE_REQUEST in that case so the audit trail keeps them apart.
 */
export const deleteAccount = async (req, res, next) => {
  try {
    const target = await loadTarget(req, res);
    if (!target) return;

    const parsed = z
      .object({ confirmation: confirmField, reason: reasonField })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors[0].message, code: 'CONFIRMATION_REQUIRED' }
      });
    }

    // Compared digits-only: the operator may type the number with spaces.
    const typed = parsed.data.confirmation.replace(/[^0-9]/g, '');
    if (typed !== String(target.mobileNumber).replace(/[^0-9]/g, '')) {
      return res.status(400).json({
        error: {
          message: "The mobile number you typed does not match this account.",
          code: 'CONFIRMATION_MISMATCH'
        }
      });
    }

    const wasPendingRequest =
      target.status === STATUS.PENDING || target.status === STATUS.ONBOARDING;
    const impact = await describeUserImpact(target);
    const snapshot = {
      mobileNumber: target.mobileNumber,
      firstName: target.firstName,
      lastName: target.lastName,
      email: target.email,
      role: target.role,
      status: target.status,
      tenantId: target.tenantId,
      cascaded: impact
    };

    await hardDeleteUser(target);

    // Written after the delete so a failed delete cannot leave a row claiming
    // it happened. The audit row is now the only trace of this account.
    await recordAudit(req, {
      action: wasPendingRequest ? 'DELETE_REQUEST' : 'DELETE_USER',
      targetType: 'USER',
      targetId: target.id,
      targetSnapshot: snapshot,
      reason: parsed.data.reason
    });

    return res.status(200).json({
      message: wasPendingRequest
        ? 'Request deleted. This number can sign up again.'
        : 'Account deleted permanently. This number can sign up again.',
      deleted: { id: target.id, role: snapshot.role },
      cascaded: impact
    });
  } catch (error) {
    next(error);
  }
};

// ── Franchises (tenants) — super admin only ─────────────────────────────

const loadTenant = async (req, res) => {
  const parsedId = idParam.safeParse(req.params.id);
  if (!parsedId.success) {
    res.status(400).json({ error: { message: 'Invalid franchise id.', code: 'INVALID_ID' } });
    return null;
  }
  const tenant = await Tenant.findByPk(parsedId.data);
  if (!tenant) {
    res.status(404).json({ error: { message: 'Franchise not found.', code: 'TENANT_NOT_FOUND' } });
    return null;
  }
  // An operator must never be able to remove the franchise they are standing
  // in — it would cascade over their own account mid-request.
  if (req.user.tenantId && String(req.user.tenantId) === String(tenant.id)) {
    res.status(400).json({
      error: {
        message: 'You cannot modify the franchise your own account belongs to.',
        code: 'CANNOT_TARGET_OWN_TENANT'
      }
    });
    return null;
  }
  return tenant;
};

/** GET /super-admin/tenants/:id/impact */
export const getTenantImpact = async (req, res, next) => {
  try {
    const tenant = await loadTenant(req, res);
    if (!tenant) return;

    const users = await User.findAll({
      where: { tenantId: tenant.id },
      attributes: ['id', 'role', 'status']
    });
    const byRole = users.reduce((acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    }, {});

    return res.status(200).json({
      tenant: { id: tenant.id, name: tenant.name, code: tenant.code, status: tenant.status },
      impact: { users: users.length, byRole },
      confirmationRequired: tenant.code
    });
  } catch (error) {
    next(error);
  }
};

/** POST /super-admin/tenants/:id/suspend | /reactivate */
export const setTenantState = (mode) => async (req, res, next) => {
  try {
    const tenant = await loadTenant(req, res);
    if (!tenant) return;

    const { reason } = z.object({ reason: reasonField }).parse(req.body ?? {});
    const result = await cascadeTenant(tenant, mode);

    await recordAudit(req, {
      action: mode === 'SUSPEND' ? 'SUSPEND_TENANT' : 'REACTIVATE_TENANT',
      targetType: 'TENANT',
      targetId: tenant.id,
      targetSnapshot: { name: tenant.name, code: tenant.code, cascaded: result },
      reason
    });

    return res.status(200).json({
      message:
        mode === 'SUSPEND'
          ? `Franchise suspended along with ${result.users} account(s).`
          : `Franchise reactivated along with its accounts.`,
      tenant: { id: tenant.id, status: tenant.status },
      cascaded: result
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /super-admin/tenants/:id */
export const deleteTenant = async (req, res, next) => {
  try {
    const tenant = await loadTenant(req, res);
    if (!tenant) return;

    const parsed = z
      .object({ confirmation: confirmField, reason: reasonField })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: { message: parsed.error.errors[0].message, code: 'CONFIRMATION_REQUIRED' }
      });
    }
    if (parsed.data.confirmation.trim().toUpperCase() !== String(tenant.code).toUpperCase()) {
      return res.status(400).json({
        error: {
          message: 'The franchise code you typed does not match.',
          code: 'CONFIRMATION_MISMATCH'
        }
      });
    }

    const snapshot = { name: tenant.name, code: tenant.code, status: tenant.status };
    const result = await cascadeTenant(tenant, 'DELETE');

    await recordAudit(req, {
      action: 'DELETE_TENANT',
      targetType: 'TENANT',
      targetId: req.params.id,
      targetSnapshot: { ...snapshot, cascaded: result },
      reason: parsed.data.reason
    });

    return res.status(200).json({
      message: `Franchise deleted along with ${result.users} account(s).`,
      cascaded: result
    });
  } catch (error) {
    next(error);
  }
};

/** GET /admin/audit-log — who did what, most recent first. */
export const getAuditLog = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const { rows, count } = await AuditLog.findAndCountAll({
      order: [['createdAt', 'DESC']],
      limit,
      offset: (page - 1) * limit
    });

    return res.status(200).json({
      items: rows,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) }
    });
  } catch (error) {
    next(error);
  }
};
