import { Router } from 'express';
import { requestOtp, verifyOtp, login, refreshToken, logout, onboardConsumer, onboardDelivery, getConsumerProfile, registerDeviceToken, getTenantsPublic } from './authController.js';
import { authGuard } from '../../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/otp', requestOtp);
authRouter.post('/otp/valid', verifyOtp);
authRouter.post('/auth/login', login);
authRouter.post('/auth/refresh', refreshToken);
authRouter.post('/auth/logout', logout);
authRouter.post('/auth/onboardConsumer', authGuard, onboardConsumer);
authRouter.post('/auth/onboardDelivery', authGuard, onboardDelivery);
authRouter.get('/auth/consumer/profile', authGuard, getConsumerProfile);
authRouter.post('/auth/device-token', authGuard, registerDeviceToken);
authRouter.get('/tenants', getTenantsPublic);
