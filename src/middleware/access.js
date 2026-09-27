import { resolveBusiness } from '../utils/helpers.js';
import { isAdminRole, isModeActive } from '../utils/modes.js';

const isAdmin = (req) => isAdminRole(req.userRole) || isAdminRole(req.user?.role);

/**
 * Only the store's owner (or a platform admin) may act on
 * `/…/:businessId/…`. Resolves the business once and exposes it as
 * `req.business`. Unknown and not-yours both answer 404 so ids cannot be
 * probed.
 */
export const requireBusinessOwner = async (req, res, next) => {
  try {
    const business = await resolveBusiness(req.params.businessId);
    if (!business || (!isAdmin(req) && business.ownerId !== req.user.id)) {
      return res.status(404).json({ error: { message: 'Business not found' } });
    }
    req.business = business;
    next();
  } catch (error) {
    next(error);
  }
};

/** The caller must be an approved user of [mode] ('selling' | 'delivering'). */
export const requireMode = (mode) => (req, res, next) => {
  if (isAdmin(req) || isModeActive(req.user, mode)) return next();
  return res.status(403).json({
    error: {
      message: mode === 'delivering'
        ? 'Only approved delivery partners can do this.'
        : 'Only approved sellers can do this.',
      code: 'MODE_NOT_ACTIVE'
    }
  });
};
