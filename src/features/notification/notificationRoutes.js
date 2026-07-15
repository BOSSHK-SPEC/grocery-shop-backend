import { Router } from 'express';
import { authGuard } from '../../middleware/auth.js';
import { getNotifications, markAsRead, markAllAsRead } from './notificationController.js';

export const notificationRouter = Router();

notificationRouter.get('/notifications', authGuard, getNotifications);
notificationRouter.patch('/notifications/:id/read', authGuard, markAsRead);
notificationRouter.post('/notifications/read-all', authGuard, markAllAsRead);
