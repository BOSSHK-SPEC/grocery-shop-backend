import { Router } from 'express';
import { 
  getPendingUsers, 
  approveUser, 
  getAdminAnalytics, 
  createMerchantDirectly, 
  createRiderDirectly,
  getMerchantsPaginated,
  getRidersPaginated,
  getDisputes,
  resolveDispute
} from './adminController.js';
import { authGuard, adminGuard } from '../../middleware/auth.js';
import { adminActionLimiter } from '../../middleware/rateLimit.js';
import {
  suspendAccount,
  reactivateAccount,
  revokeAccountSessions,
  getAccountImpact,
  deleteAccount,
  getAuditLog
} from './accountAdminController.js';

const adminRouter = Router();

adminRouter.get('/admin/pending-users', authGuard, adminGuard, getPendingUsers);
adminRouter.post('/admin/approve-user', authGuard, adminGuard, approveUser);
adminRouter.get('/admin/analytics', authGuard, adminGuard, getAdminAnalytics);
adminRouter.post('/admin/create-merchant', authGuard, adminGuard, createMerchantDirectly);
adminRouter.post('/admin/create-rider', authGuard, adminGuard, createRiderDirectly);
adminRouter.get('/admin/merchants', authGuard, adminGuard, getMerchantsPaginated);
adminRouter.get('/admin/riders', authGuard, adminGuard, getRidersPaginated);
adminRouter.get('/admin/disputes', authGuard, adminGuard, getDisputes);
adminRouter.put('/admin/disputes/:orderId/resolve', authGuard, adminGuard, resolveDispute);


// ── Account lifecycle ───────────────────────────────────────────────────
// Available to franchise admins (scoped to their own franchise by
// authorizeTargetAction) and to the super admin (unscoped). Every one of
// these is rate limited and written to the audit log.
adminRouter.get('/admin/users/:id/impact', authGuard, adminGuard, getAccountImpact);
adminRouter.post('/admin/users/:id/suspend', authGuard, adminGuard, adminActionLimiter, suspendAccount);
adminRouter.post('/admin/users/:id/reactivate', authGuard, adminGuard, adminActionLimiter, reactivateAccount);
adminRouter.post('/admin/users/:id/revoke-sessions', authGuard, adminGuard, adminActionLimiter, revokeAccountSessions);
adminRouter.delete('/admin/users/:id', authGuard, adminGuard, adminActionLimiter, deleteAccount);
adminRouter.get('/admin/audit-log', authGuard, adminGuard, getAuditLog);

export default adminRouter;
