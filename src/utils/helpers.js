import { Op } from 'sequelize';
import { Business } from '../models/index.js';

// Image handling lives in src/storage/ — every upload goes to object storage
// through resolveImageInput(); nothing writes images to local disk any more.

export const resolveBusiness = async (businessId) => {
  return await Business.findOne({
    where: {
      [Op.or]: [
        { id: businessId },
        { businessCode: businessId }
      ]
    }
  });
};

/**
 * Whether a business is currently taking new orders: the seller's manual
 * toggle is on, and any "pause for a bit" window has elapsed. Mirrors the
 * rule the seller app shows on the store settings and "Sell today" screens.
 */
export const isAcceptingOrders = (business) => {
  if (business.acceptingOrders === false) return false;
  if (business.pausedUntil && new Date(business.pausedUntil) > new Date()) return false;
  return true;
};
