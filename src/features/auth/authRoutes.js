import { Router } from 'express';
import { requestOtp, verifyOtp, login } from './authController.js';

export const authRouter = Router();

authRouter.post('/otp', requestOtp);
authRouter.post('/otp/valid', verifyOtp);
authRouter.post('/auth/login', login);
