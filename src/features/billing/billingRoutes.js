import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { getBills, createBill, getBillById, updateBill, deleteBill } from './billingController.js';

export const billingRouter = Router();

billingRouter.get('/business/:businessId/bills', authGuard, getBills);
billingRouter.get('/business/:businessId/bills/:billId', authGuard, getBillById);
billingRouter.post('/business/:businessId/bills', authGuard, createBill);
billingRouter.put('/business/:businessId/bills/:billId', authGuard, updateBill);
billingRouter.delete('/business/:businessId/bills/:billId', authGuard, deleteBill);
