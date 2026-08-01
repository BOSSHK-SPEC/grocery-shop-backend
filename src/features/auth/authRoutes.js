import { Router } from 'express';
import { requestOtp, verifyOtp, login, refreshToken, logout, onboardConsumer, onboardDelivery, getConsumerProfile, registerDeviceToken, getTenantsPublic, deleteAccount } from './authController.js';
import { authGuard } from '../../middleware/auth.js';
import { authLimiter } from '../../middleware/rateLimit.js';

export const authRouter = Router();

authRouter.post('/otp', authLimiter, requestOtp);
authRouter.post('/otp/valid', authLimiter, verifyOtp);
authRouter.post('/auth/login', authLimiter, login);
authRouter.post('/auth/deleteAccount', authLimiter, deleteAccount);
authRouter.post('/auth/refresh', authLimiter, refreshToken);
authRouter.post('/auth/logout', logout);
authRouter.post('/auth/onboardConsumer', authGuard, onboardConsumer);
authRouter.post('/auth/onboardDelivery', authGuard, onboardDelivery);
authRouter.get('/auth/consumer/profile', authGuard, getConsumerProfile);
authRouter.post('/auth/device-token', authGuard, registerDeviceToken);
authRouter.get('/tenants', getTenantsPublic);
