import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { requireBusinessOwner } from '../../middleware/access.js';
import { getOrders, createOrder, updateOrderStatus, getConsumerOrders, cancelOrder, getOrderQuote, getGstInvoice, requestOrderReturn } from './orderController.js';

export const orderRouter = Router();

orderRouter.get('/business/:businessId/orders', authGuard, requireBusinessOwner, getOrders);
orderRouter.post('/business/:businessId/orders', authGuard, createOrder);
orderRouter.put('/business/:businessId/orders/:orderId/status', authGuard, requireBusinessOwner, updateOrderStatus);
orderRouter.get('/consumer/orders', authGuard, getConsumerOrders);
orderRouter.post('/consumer/orders/quote', authGuard, getOrderQuote);
orderRouter.get('/consumer/orders/:orderId/gst-invoice', authGuard, getGstInvoice);
orderRouter.post('/consumer/orders/:orderId/return', authGuard, requestOrderReturn);
orderRouter.put('/consumer/orders/:orderId/cancel', authGuard, cancelOrder);


