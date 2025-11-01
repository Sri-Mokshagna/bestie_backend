import { Notification, NotificationType } from '../models/Notification';
import { Types } from 'mongoose';

export const notificationService = {
  /**
   * Send a notification to a user
   */
  async sendNotification(
    userId: string | Types.ObjectId,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      const notification = await Notification.create({
        userId,
        type,
        title,
        message,
        data: data || {},
        isRead: false,
      });

      console.log(`✅ Notification sent to user ${userId}: ${title}`);
      return notification;
    } catch (error) {
      console.error('❌ Error sending notification:', error);
      throw error;
    }
  },

  /**
   * Send responder approval notification
   */
  async sendApprovalNotification(userId: string | Types.ObjectId, userName: string) {
    return this.sendNotification(
      userId,
      NotificationType.RESPONDER_APPROVED,
      '🎉 Congratulations!',
      `Your responder application has been approved! You can now start accepting calls and earning money. Welcome to the Bestie family!`,
      { approved: true }
    );
  },

  /**
   * Send responder rejection notification
   */
  async sendRejectionNotification(
    userId: string | Types.ObjectId,
    userName: string,
    reason?: string
  ) {
    const message = reason
      ? `Your responder application has been rejected. Reason: ${reason}. You may reapply after addressing the issues.`
      : `Your responder application has been rejected. Please review our guidelines and you may reapply.`;

    return this.sendNotification(
      userId,
      NotificationType.RESPONDER_REJECTED,
      'Application Update',
      message,
      { rejected: true, reason }
    );
  },

  /**
   * Get user notifications
   */
  async getUserNotifications(userId: string, page = 1, limit = 20, unreadOnly = false) {
    const skip = (page - 1) * limit;
    const query: any = { userId };

    if (unreadOnly) {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(query);

    return {
      notifications,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      throw new Error('Notification not found');
    }

    return notification;
  },

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId: string) {
    await Notification.updateMany({ userId, isRead: false }, { isRead: true });
  },

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string) {
    return await Notification.countDocuments({ userId, isRead: false });
  },

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string) {
    const notification = await Notification.findOneAndDelete({
      _id: notificationId,
      userId,
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return notification;
  },
};
