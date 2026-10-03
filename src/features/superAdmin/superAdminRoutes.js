import { Router } from 'express';
import { authGuard, superAdminGuard } from '../../middleware/auth.js';
import {
  getAdminsList,
  promoteToAdmin,
  demoteAdmin,
  getGlobalSettings,
  saveGlobalSettings,
  getFinanceSummary,
  getTenantsList,
  createTenant,
  getConsumersPaginated
} from './superAdminController.js';
import {
  getTenantImpact,
  setTenantState,
  deleteTenant
} from '../admin/accountAdminController.js';
import { adminActionLimiter } from '../../middleware/rateLimit.js';

const superAdminRouter = Router();

// Gated routes for super admin only
superAdminRouter.get('/super-admin/admins', authGuard, superAdminGuard, getAdminsList);
superAdminRouter.post('/super-admin/admins', authGuard, superAdminGuard, promoteToAdmin);
superAdminRouter.delete('/super-admin/admins/:id', authGuard, superAdminGuard, demoteAdmin);
superAdminRouter.get('/super-admin/settings', authGuard, superAdminGuard, getGlobalSettings);
superAdminRouter.post('/super-admin/settings', authGuard, superAdminGuard, saveGlobalSettings);
superAdminRouter.get('/super-admin/finance', authGuard, superAdminGuard, getFinanceSummary);
superAdminRouter.get('/super-admin/tenants', authGuard, superAdminGuard, getTenantsList);
superAdminRouter.post('/super-admin/tenants', authGuard, superAdminGuard, createTenant);
superAdminRouter.get('/super-admin/consumers', authGuard, superAdminGuard, getConsumersPaginated);

// ── Franchise lifecycle ─────────────────────────────────────────────────
// Suspending or deleting a franchise cascades to every account inside it.
superAdminRouter.get('/super-admin/tenants/:id/impact', authGuard, superAdminGuard, getTenantImpact);
superAdminRouter.post('/super-admin/tenants/:id/suspend', authGuard, superAdminGuard, adminActionLimiter, setTenantState('SUSPEND'));
superAdminRouter.post('/super-admin/tenants/:id/reactivate', authGuard, superAdminGuard, adminActionLimiter, setTenantState('REACTIVATE'));
superAdminRouter.delete('/super-admin/tenants/:id', authGuard, superAdminGuard, adminActionLimiter, deleteTenant);

export default superAdminRouter;
