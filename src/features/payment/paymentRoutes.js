import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { getPaymentConfig, createPaymentOrder, verifyPayment } from './paymentController.js';

export const paymentRouter = Router();

paymentRouter.get('/payment/config', authGuard, getPaymentConfig);
paymentRouter.post('/payment/order', authGuard, createPaymentOrder);
paymentRouter.post('/payment/verify', authGuard, verifyPayment);
