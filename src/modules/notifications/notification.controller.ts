import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { AppError } from '../../middleware/errorHandler';
import { notificationService } from '../../lib/notification';

export const notificationController = {
  async getNotifications(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.getUserNotifications(
      req.user.id,
      page,
      limit,
      unreadOnly
    );

    res.json(result);
  },

  async getUnreadCount(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const count = await notificationService.getUnreadCount(req.user.id);

    res.json({ count });
  },

  async markAsRead(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { notificationId } = req.params;

    const notification = await notificationService.markAsRead(
      notificationId,
      req.user.id
    );

    res.json({ notification });
  },

  async markAllAsRead(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    await notificationService.markAllAsRead(req.user.id);

    res.json({ message: 'All notifications marked as read' });
  },

  async deleteNotification(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { notificationId } = req.params;

    await notificationService.deleteNotification(notificationId, req.user.id);

    res.json({ message: 'Notification deleted' });
  },
};
