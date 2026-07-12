import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { getOrders, createOrder, updateOrderStatus } from './orderController.js';

export const orderRouter = Router();

orderRouter.get('/business/:businessId/orders', authGuard, getOrders);
orderRouter.post('/business/:businessId/orders', authGuard, createOrder);
orderRouter.put('/business/:businessId/orders/:orderId/status', authGuard, updateOrderStatus);
