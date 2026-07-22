import express from 'express';
import { authGuard } from '../../middleware/auth.js';
import * as deliveryController from './deliveryController.js';

export const deliveryRouter = express.Router();

// Apply authGuard to all delivery routes
deliveryRouter.use(authGuard);

// Location & Availability APIs
deliveryRouter.patch('/location', deliveryController.updateLocation);
deliveryRouter.get('/orders/:id/location', deliveryController.getDeliveryLocation);
deliveryRouter.post('/status', deliveryController.toggleOnlineStatus);

// Delivery Job Claims & Transitions APIs
deliveryRouter.get('/orders/available', deliveryController.getAvailableDeliveries);
deliveryRouter.get('/orders/active', deliveryController.getActiveDeliveries);
deliveryRouter.get('/orders/history', deliveryController.getDeliveryHistory);
deliveryRouter.post('/orders/:id/claim', deliveryController.claimDelivery);
deliveryRouter.post('/orders/:id/pickup', deliveryController.startDelivery);
deliveryRouter.post('/orders/:id/complete', deliveryController.completeDelivery);

// Ratings & Complaints APIs
deliveryRouter.post('/orders/:id/rate', deliveryController.rateOrder);
deliveryRouter.get('/orders/:id/ratings', deliveryController.getOrderRatings);
deliveryRouter.post('/orders/:id/complaint', deliveryController.fileComplaint);
deliveryRouter.get('/riders/:riderId/rating', deliveryController.getRiderRating);

// Chat APIs
deliveryRouter.get('/orders/:orderId/chat', deliveryController.getChatMessages);
deliveryRouter.post('/orders/:orderId/chat', deliveryController.sendChatMessage);
