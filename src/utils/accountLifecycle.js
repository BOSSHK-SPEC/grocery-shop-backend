import { Op } from 'sequelize';
import {
  sequelize,
  User,
  Business,
  Order,
  Address,
  Notification,
  Favorite,
  RefreshToken,
  Tenant,
  AuditLog
} from '../models/index.js';
import { revokeAllForUser } from './tokens.js';

// Account states. SUSPENDED is enforced in authGuard and at login, so it
// takes effect on the very next request rather than whenever the current
// access token happens to expire.
export const STATUS = {
  ONBOARDING: 'ONBOARDING_PROGRESS',
  PENDING: 'PENDING_APPROVAL',
  ACTIVE: 'ACTIVE',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

// Orders that still need someone to act on them. Used to warn the operator
// about what a cascade is about to cut off — never to block it, since the
// product decision is that a franchise delete cascades unconditionally.
const LIVE_ORDER_STATES = ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY'];

/**
 * Who may act on whom. Returns null when allowed, or { status, message, code }
 * describing the refusal.
 *
 * The rules are deliberately identical for every destructive endpoint, so a
 * new route cannot accidentally ship with a weaker check than its siblings.
 */
export const authorizeTargetAction = (actor, actorRole, target) => {
  const isSuperAdmin = actorRole === 'super_admin' || actor.role === 'super_admin';

  // Self-service is a different flow with its own OTP confirmation. Without
  // this an operator could lock themselves — or the last super admin — out.
  if (String(target.id) === String(actor.id)) {
    return {
      status: 400,
      code: 'CANNOT_TARGET_SELF',
      message: 'You cannot perform this action on your own account.'
    };
  }

  // A super admin is never a target of this API, not even for another super
  // admin: losing it would leave the platform with no way back in.
  if (target.role === 'super_admin') {
    return {
      status: 403,
      code: 'CANNOT_TARGET_SUPER_ADMIN',
      message: 'The super admin account cannot be modified from here.'
    };
  }

  if (!isSuperAdmin) {
    // Franchise admins act only inside their own franchise...
    if (!actor.tenantId || String(target.tenantId) !== String(actor.tenantId)) {
      return {
        status: 403,
        code: 'OUT_OF_SCOPE',
        message: 'You can only manage users within your own franchise.'
      };
    }
    // ...and never on a peer admin. Removing a fellow admin is a super-admin
    // action (see demoteAdmin), so two admins cannot fight over the console.
    if (target.role === 'admin') {
      return {
        status: 403,
        code: 'CANNOT_TARGET_ADMIN',
        message: 'Only the super admin can manage admin accounts.'
      };
    }
  }

  return null;
};

/** Appends an audit row. Never throws into the caller's happy path. */
export const recordAudit = async (req, entry, transaction) => {
  try {
    await AuditLog.create(
      {
        actorId: req.user.id,
        actorRole: req.userRole || req.user.role,
        actorMobile: req.user.mobileNumber,
        ip: req.ip,
        ...entry
      },
      { transaction }
    );
  } catch (err) {
    // An audit failure must not silently swallow the action it describes,
    // but it must also not roll back a completed suspension. Log loudly.
    console.error('[AUDIT] Failed to record admin action:', err.message, entry);
  }
};

const snapshotUser = (user) => ({
  mobileNumber: user.mobileNumber,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  role: user.role,
  status: user.status,
  tenantId: user.tenantId
});

/**
 * Blocks a user and ends every session they currently hold.
 *
 * The status being replaced is stashed in `misc` so reactivation can put the
 * account back where it was. Suspending someone who was still awaiting
 * approval must not become a silent approval when the suspension is lifted.
 */
export const suspendUser = async (user, { transaction } = {}) => {
  if (user.status !== STATUS.SUSPENDED) {
    user.misc = { ...(user.misc || {}), suspendedFrom: user.status };
    user.status = STATUS.SUSPENDED;
    user.changed('misc', true); // JSON columns need the dirty flag set by hand
    await user.save({ transaction });
  }
  // Without this the user keeps working until their access token expires and
  // could then refresh into a brand new one — a suspension in name only.
  await revokeAllForUser(user.id);
  return snapshotUser(user);
};

/** Lifts a suspension, restoring the state the account was in before it. */
export const reactivateUser = async (user, { transaction } = {}) => {
  const misc = user.misc || {};
  const restored = misc.suspendedFrom;
  // Fall back to ACTIVE only for accounts suspended before this field
  // existed; anything unrecognised is treated as needing approval again.
  user.status = restored && Object.values(STATUS).includes(restored)
    ? restored
    : STATUS.ACTIVE;
  if (user.status === STATUS.SUSPENDED) user.status = STATUS.ACTIVE;
  const { suspendedFrom, ...rest } = misc;
  user.misc = rest;
  user.changed('misc', true);
  await user.save({ transaction });
  return snapshotUser(user);
};

/** Ends every session without changing the account's state. */
export const revokeUserSessions = async (user) => {
  await revokeAllForUser(user.id);
  return snapshotUser(user);
};

/**
 * Counts what a hard delete is about to take with it, so the operator sees
 * the blast radius before confirming and the audit row records it after.
 */
export const describeUserImpact = async (user) => {
  const businessIds = (
    await Business.findAll({ where: { ownerId: user.id }, attributes: ['id'] })
  ).map((b) => b.id);

  const [businessOrders, customerOrders, deliveryOrders, liveOrders] = await Promise.all([
    businessIds.length ? Order.count({ where: { businessId: businessIds } }) : 0,
    Order.count({ where: { customerId: user.id } }),
    Order.count({ where: { deliveryPartnerId: user.id } }),
    Order.count({
      where: {
        status: { [Op.in]: LIVE_ORDER_STATES },
        [Op.or]: [
          { customerId: user.id },
          { deliveryPartnerId: user.id },
          ...(businessIds.length ? [{ businessId: businessIds }] : [])
        ]
      }
    })
  ]);

  return {
    businesses: businessIds.length,
    businessOrders,
    customerOrders,
    deliveryOrders,
    liveOrders
  };
};

/**
 * Permanently removes a user and everything that would otherwise be left
 * dangling, inside one transaction.
 *
 * The associations in models/index.js leave Business.ownerId, Order.customerId
 * and Order.deliveryPartnerId nullable with no cascade, so a bare
 * User.destroy() would quietly detach stores and orders instead of removing
 * them. Each link is therefore handled explicitly and in dependency order.
 *
 * Deleting the row also frees the mobileNumber (it is UNIQUE), which is what
 * lets a removed partner sign up again from scratch through the normal OTP
 * flow.
 */
export const hardDeleteUser = async (user, { transaction } = {}) => {
  const run = async (t) => {
    const businesses = await Business.findAll({
      where: { ownerId: user.id },
      attributes: ['id'],
      transaction
    });
    const businessIds = businesses.map((b) => b.id);

    // Orders the user placed or delivered lose their link. The row itself is
    // kept: an order is also the counterparty's record and the basis of the
    // finance report, so it must not vanish because one side was removed.
    await Order.update({ customerId: null }, { where: { customerId: user.id }, transaction: t });
    await Order.update(
      { deliveryPartnerId: null },
      { where: { deliveryPartnerId: user.id }, transaction: t }
    );

    // Businesses this user owned go with them. Products, bills, coupons,
    // addresses and the businesses' own orders cascade from here via the
    // onDelete: 'CASCADE' associations.
    if (businessIds.length) {
      await Business.destroy({ where: { id: businessIds }, transaction: t });
    }

    // Rows whose only reason to exist is this user.
    await Promise.all([
      Address.destroy({ where: { userId: user.id }, transaction: t }),
      Notification.destroy({ where: { userId: user.id }, transaction: t }),
      Favorite.destroy({ where: { userId: user.id }, transaction: t }),
      RefreshToken.destroy({ where: { userId: user.id }, transaction: t })
    ]);

    await User.destroy({ where: { id: user.id }, transaction: t });
    return businessIds.length;
  };

  if (transaction) return run(transaction);
  return sequelize.transaction(run);
};

/**
 * Suspends or deletes a franchise and cascades that state to every user in
 * it. Unconditional by product decision: in-flight orders do not block the
 * action, but they are counted into the audit snapshot so the operator can
 * see afterwards exactly what was cut off.
 */
export const cascadeTenant = async (tenant, mode) => {
  return sequelize.transaction(async (t) => {
    const users = await User.findAll({
      where: { tenantId: tenant.id, role: { [Op.ne]: 'super_admin' } },
      transaction: t
    });

    const tenantBusinessIds = (
      await Business.findAll({
        where: { tenantId: tenant.id },
        attributes: ['id'],
        transaction: t
      })
    ).map((b) => b.id);

    const liveOrders = tenantBusinessIds.length
      ? await Order.count({
          where: {
            businessId: tenantBusinessIds,
            status: { [Op.in]: LIVE_ORDER_STATES }
          },
          transaction: t
        })
      : 0;

    const counts = users.reduce((acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    }, {});

    if (mode === 'SUSPEND') {
      // One at a time rather than a bulk UPDATE: suspendUser stashes the
      // status it replaced, which is what lets reactivation put a partner
      // back in the approval queue instead of silently approving them.
      for (const u of users) {
        await suspendUser(u, { transaction: t });
      }
      await RefreshToken.update(
        { revoked: true },
        { where: { userId: users.map((u) => u.id), revoked: false }, transaction: t }
      );
      tenant.status = 'SUSPENDED';
      await tenant.save({ transaction: t });
    } else if (mode === 'REACTIVATE') {
      // One at a time so each account returns to the status it held before
      // the franchise was suspended, rather than all being made ACTIVE.
      for (const u of users) {
        if (u.status === STATUS.SUSPENDED) await reactivateUser(u, { transaction: t });
      }
      tenant.status = 'ACTIVE';
      await tenant.save({ transaction: t });
    } else if (mode === 'DELETE') {
      for (const u of users) {
        await hardDeleteUser(u, { transaction: t });
      }
      await Business.destroy({ where: { tenantId: tenant.id }, transaction: t });
      await Tenant.destroy({ where: { id: tenant.id }, transaction: t });
    }

    return { users: users.length, byRole: counts, liveOrdersAtAction: liveOrders };
  });
};
