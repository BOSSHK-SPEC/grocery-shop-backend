/**
 * Per-mode capability status for one account.
 *
 * One GroZerry account can shop, sell and deliver. `User.role` holds a single
 * value (it still drives the legacy web console), so it cannot say "approved
 * seller AND rider in review". The truth for each mode lives in
 * `user.misc.modes`:
 *
 *   misc.modes = {
 *     selling:    { status: 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED', updatedAt },
 *     delivering: { status: ..., vehicleType, updatedAt }
 *   }
 *
 * Accounts created before this existed have no `misc.modes`; for them the
 * status is derived from the legacy fields so nobody loses access.
 */

export const ModeStatus = {
  ACTIVE: 'ACTIVE',
  PENDING: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  NOT_STARTED: 'NOT_STARTED',
};

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

function businessIdsOf(user) {
  const ids = user?.misc?.businessId;
  return Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
}

function legacySelling(user) {
  if (businessIdsOf(user).length === 0) return ModeStatus.NOT_STARTED;
  // Approved standalone merchants are promoted to `admin`; merchants carry
  // the approval state in `user.status`.
  if (user.role === 'merchant') return user.status || ModeStatus.ACTIVE;
  return ModeStatus.ACTIVE;
}

function legacyDelivering(user) {
  if (user.role === 'delivery') return user.status || ModeStatus.PENDING;
  return ModeStatus.NOT_STARTED;
}

/** `{ shopping, selling, delivering }`, each `{ status, ... }`. */
export function modesOf(user) {
  const stored = user?.misc?.modes || {};
  const selling = businessIdsOf(user).length === 0
    ? ModeStatus.NOT_STARTED
    : stored.selling?.status || legacySelling(user);
  const delivering = stored.delivering?.status || legacyDelivering(user);
  return {
    shopping: { status: ModeStatus.ACTIVE },
    selling: { status: selling, businessIds: businessIdsOf(user) },
    delivering: {
      status: delivering,
      ...(stored.delivering?.vehicleType ? { vehicleType: stored.delivering.vehicleType } : {}),
    },
  };
}

export function isModeActive(user, mode) {
  return modesOf(user)[mode]?.status === ModeStatus.ACTIVE;
}

/** Returns a new `misc` with [mode] set to [status] (plus [extra] fields). */
export function withModeStatus(misc, mode, status, extra = {}) {
  const modes = { ...(misc?.modes || {}) };
  modes[mode] = { ...(modes[mode] || {}), ...extra, status, updatedAt: new Date().toISOString() };
  return { ...(misc || {}), modes };
}

/**
 * Applies an admin decision to the modes waiting for review, so an approval
 * never touches a mode that was already decided. With [only] the decision is
 * limited to that one mode, which is how an admin approves a seller
 * application without also approving the same account's rider application.
 */
export function applyReviewDecision(misc, decision, only = null) {
  const next = decision === 'approve' ? ModeStatus.ACTIVE : ModeStatus.REJECTED;
  const modes = { ...(misc?.modes || {}) };
  for (const [name, value] of Object.entries(modes)) {
    if (only && name !== only) continue;
    if (value?.status === ModeStatus.PENDING) {
      modes[name] = { ...value, status: next, updatedAt: new Date().toISOString() };
    }
  }
  return { ...(misc || {}), modes };
}

/** The modes an admin can be asked to review: `selling` and `delivering`. */
export const REVIEWABLE_MODES = ['selling', 'delivering'];

/** Modes of [user] currently waiting for an admin decision. */
export function pendingModes(user) {
  const modes = modesOf(user);
  return REVIEWABLE_MODES.filter((mode) => modes[mode].status === ModeStatus.PENDING);
}

/**
 * Status of one mode as a list for that mode should show it. Falls back to the
 * legacy `status` for accounts whose mode cannot be derived, so a row never
 * loses its state just because it predates `misc.modes`.
 */
export function statusForView(user, mode) {
  const status = modesOf(user)[mode]?.status;
  return status && status !== ModeStatus.NOT_STARTED ? status : user.status;
}

/**
 * Legacy `status` after a review. It stays PENDING_APPROVAL while any
 * application is still waiting (that is what keeps the account in the approvals
 * list), and a rejection never locks out an account that still works in
 * another mode.
 */
export function legacyStatusAfterReview(user) {
  const tracked = REVIEWABLE_MODES.map((m) => user?.misc?.modes?.[m]?.status).filter(Boolean);
  if (tracked.includes(ModeStatus.PENDING)) return ModeStatus.PENDING;
  if (tracked.includes(ModeStatus.ACTIVE)) return ModeStatus.ACTIVE;
  return ModeStatus.REJECTED;
}

/**
 * Legacy `role`/`status` to write when an account applies for [mode]. The web
 * console and the approvals list still read them, but an account that already
 * works in another mode must never be demoted or locked out by the new
 * application (that is enforced by `misc.modes`, not these fields).
 */
export function legacyFieldsForApplication(user, mode) {
  const role = user.role;
  const keepRole = ADMIN_ROLES.has(role) || (mode === 'selling' && role === 'delivery') || (mode === 'delivering' && role === 'merchant');
  return {
    role: keepRole ? role : mode === 'selling' ? 'merchant' : 'delivery',
    // PENDING_APPROVAL puts the account in the admins' approvals list.
    status: ModeStatus.PENDING,
  };
}

export const isAdminRole = (role) => ADMIN_ROLES.has(role);
