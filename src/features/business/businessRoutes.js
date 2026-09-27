import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { requireBusinessOwner } from '../../middleware/access.js';
import {
  getAllBusinessType,
  createProfile,
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessAnalytics,
  getAllBusinesses,
  saveStoreProfile,
  submitKyc,
  savePayoutAccount,
  getTopProducts,
  getPayouts
} from './businessController.js';

export const businessRouter = Router();

businessRouter.get('/business/getAllBusinessType', authGuard, getAllBusinessType);
businessRouter.get('/business', authGuard, getAllBusinesses);
businessRouter.post('/business/createProfile', authGuard, createProfile);
businessRouter.get('/business/:businessId/profile', authGuard, getBusinessProfile);
businessRouter.put('/business/:businessId/profile', authGuard, requireBusinessOwner, updateBusinessProfile);
businessRouter.put('/business/:businessId/store-profile', authGuard, requireBusinessOwner, saveStoreProfile);
businessRouter.post('/business/:businessId/kyc', authGuard, requireBusinessOwner, submitKyc);
businessRouter.post('/business/:businessId/payout-account', authGuard, requireBusinessOwner, savePayoutAccount);
businessRouter.get('/business/:businessId/analytics', authGuard, requireBusinessOwner, getBusinessAnalytics);
businessRouter.get('/business/:businessId/analytics/top-products', authGuard, requireBusinessOwner, getTopProducts);
businessRouter.get('/business/:businessId/payouts', authGuard, requireBusinessOwner, getPayouts);

