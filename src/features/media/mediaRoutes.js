import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { uploadRequestLimiter } from '../../middleware/rateLimit.js';
import { requestImageUpload } from './mediaController.js';

export const mediaRouter = Router();

// authGuard runs first so the limiter can key on the user, not the IP.
mediaRouter.post('/media/upload-requests', authGuard, uploadRequestLimiter, requestImageUpload);
