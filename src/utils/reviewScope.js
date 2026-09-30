const isSuperAdmin = (actor, actorRole) =>
  actorRole === 'super_admin' || actor?.role === 'super_admin';

// `id` is a primary key and never null, so this matches no row on any model.
const NO_ACCESS = Object.freeze({ id: null });

/**
 * Sequelize `where` fragment for the people and stores an admin may see and act
 * on in the console.
 *
 *  - super admin:    everything, including standalone shops (a shop that has no
 *                    franchise, or a brand-new tenant with no admin yet). Those
 *                    applications are the super admin's to review.
 *  - franchise admin: only their own tenant, never another franchise's and
 *                    never a standalone shop's.
 *  - admin without a tenant: nothing. With no franchise there is no scope to
 *                    act in, which is the same rule authorizeTargetAction uses.
 */
export const reviewScopeWhere = (actor, actorRole) => {
  if (isSuperAdmin(actor, actorRole)) return {};
  if (actor?.tenantId) return { tenantId: actor.tenantId };
  return NO_ACCESS;
};

/** Single-row counterpart of {@link reviewScopeWhere}, used before approving. */
export const canReviewUser = (actor, actorRole, target) => {
  if (isSuperAdmin(actor, actorRole)) return true;
  return Boolean(actor?.tenantId) && String(target.tenantId) === String(actor.tenantId);
};
