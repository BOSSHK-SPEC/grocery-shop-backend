import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import {
  getAllBusinessType,
  createProfile,
  getBusinessProfile,
  updateBusinessProfile,
  getBusinessAnalytics,
  getAllBusinesses
} from './businessController.js';

export const businessRouter = Router();

businessRouter.get('/business/getAllBusinessType', authGuard, getAllBusinessType);
businessRouter.get('/business', authGuard, getAllBusinesses);
businessRouter.post('/business/createProfile', authGuard, createProfile);
businessRouter.get('/business/:businessId/profile', authGuard, getBusinessProfile);
businessRouter.put('/business/:businessId/profile', authGuard, updateBusinessProfile);
businessRouter.get('/business/:businessId/analytics', authGuard, getBusinessAnalytics);
