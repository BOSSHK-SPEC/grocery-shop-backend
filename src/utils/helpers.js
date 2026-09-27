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
