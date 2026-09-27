import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authGuard } from '../../middleware/auth.js';
import { getOrderTracking } from './trackingController.js';

export const trackingRouter = Router();

// The socket is the live channel; this is only the fallback/first paint, so a
// generous-but-finite per-user cap is enough to stop a polling loop gone wrong.
const trackingLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: { error: { message: 'Too many tracking requests. Please slow down.' } }
});

trackingRouter.get('/consumer/orders/:orderId/tracking', authGuard, trackingLimiter, getOrderTracking);
