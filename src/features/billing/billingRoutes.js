import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { requireBusinessOwner } from '../../middleware/access.js';
import { getBills, createBill, getBillById, updateBill, deleteBill } from './billingController.js';

export const billingRouter = Router();

billingRouter.get('/business/:businessId/bills', authGuard, requireBusinessOwner, getBills);
billingRouter.get('/business/:businessId/bills/:billId', authGuard, requireBusinessOwner, getBillById);
billingRouter.post('/business/:businessId/bills', authGuard, requireBusinessOwner, createBill);
billingRouter.put('/business/:businessId/bills/:billId', authGuard, requireBusinessOwner, updateBill);
billingRouter.delete('/business/:businessId/bills/:billId', authGuard, requireBusinessOwner, deleteBill);
