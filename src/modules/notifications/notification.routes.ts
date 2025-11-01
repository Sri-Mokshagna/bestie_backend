import { Router } from 'express';
import { notificationController } from './notification.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// All notification routes require authentication
router.get('/', authenticate, asyncHandler(notificationController.getNotifications));
router.get('/unread-count', authenticate, asyncHandler(notificationController.getUnreadCount));
router.patch('/:notificationId/read', authenticate, asyncHandler(notificationController.markAsRead));
router.patch('/read-all', authenticate, asyncHandler(notificationController.markAllAsRead));
router.delete('/:notificationId', authenticate, asyncHandler(notificationController.deleteNotification));

export default router;
