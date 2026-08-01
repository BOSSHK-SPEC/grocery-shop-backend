import { Router } from 'express';
import { authGuard, superAdminGuard } from '../../middleware/auth.js';
import {
  listApplicableCoupons,
  validateCoupon,
  listAllCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} from './couponController.js';

export const couponRouter = Router();

couponRouter.get('/consumer/coupons', authGuard, listApplicableCoupons);
couponRouter.post('/consumer/coupons/validate', authGuard, validateCoupon);

couponRouter.get('/super-admin/coupons', authGuard, superAdminGuard, listAllCoupons);
couponRouter.post('/super-admin/coupons', authGuard, superAdminGuard, createCoupon);
couponRouter.put('/super-admin/coupons/:id', authGuard, superAdminGuard, updateCoupon);
couponRouter.delete('/super-admin/coupons/:id', authGuard, superAdminGuard, deleteCoupon);
