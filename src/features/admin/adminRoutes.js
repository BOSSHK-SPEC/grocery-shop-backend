import { Router } from 'express';
import { 
  getPendingUsers, 
  approveUser, 
  getAdminAnalytics, 
  createMerchantDirectly, 
  createRiderDirectly,
  getMerchantsPaginated,
  getRidersPaginated
} from './adminController.js';
import { authGuard, adminGuard } from '../../middleware/auth.js';

const adminRouter = Router();

adminRouter.get('/admin/pending-users', authGuard, adminGuard, getPendingUsers);
adminRouter.post('/admin/approve-user', authGuard, adminGuard, approveUser);
adminRouter.get('/admin/analytics', authGuard, adminGuard, getAdminAnalytics);
adminRouter.post('/admin/create-merchant', authGuard, adminGuard, createMerchantDirectly);
adminRouter.post('/admin/create-rider', authGuard, adminGuard, createRiderDirectly);
adminRouter.get('/admin/merchants', authGuard, adminGuard, getMerchantsPaginated);
adminRouter.get('/admin/riders', authGuard, adminGuard, getRidersPaginated);

export default adminRouter;
