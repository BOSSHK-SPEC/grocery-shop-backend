import express from 'express';
import { authGuard } from '../../middleware/auth.js';
import * as deliveryController from './deliveryController.js';
import { requireMode } from '../../middleware/access.js';

// Rider-only endpoints: the caller must be an approved delivery partner.
const rider = requireMode('delivering');

export const deliveryRouter = express.Router();

// Apply authGuard to all delivery routes
deliveryRouter.use(authGuard);

// Location & Availability APIs
deliveryRouter.patch('/location', rider, deliveryController.updateLocation);
deliveryRouter.get('/orders/:id/location', deliveryController.getDeliveryLocation);
deliveryRouter.post('/status', rider, deliveryController.toggleOnlineStatus);

// Delivery Job Claims & Transitions APIs
deliveryRouter.get('/orders/available', rider, deliveryController.getAvailableDeliveries);
deliveryRouter.get('/orders/active', rider, deliveryController.getActiveDeliveries);
deliveryRouter.get('/orders/history', rider, deliveryController.getDeliveryHistory);
deliveryRouter.post('/orders/:id/claim', rider, deliveryController.claimDelivery);
deliveryRouter.post('/orders/:id/pickup', rider, deliveryController.startDelivery);
deliveryRouter.post('/orders/:id/complete', rider, deliveryController.completeDelivery);

// Ratings & Complaints APIs
deliveryRouter.post('/orders/:id/rate', deliveryController.rateOrder);
deliveryRouter.get('/orders/:id/ratings', deliveryController.getOrderRatings);
deliveryRouter.post('/orders/:id/complaint', deliveryController.fileComplaint);
deliveryRouter.get('/riders/:riderId/rating', deliveryController.getRiderRating);

// Chat APIs
deliveryRouter.get('/orders/:orderId/chat', deliveryController.getChatMessages);
deliveryRouter.post('/orders/:orderId/chat', deliveryController.sendChatMessage);
