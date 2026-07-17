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
  createTenant
} from './superAdminController.js';

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

export default superAdminRouter;
