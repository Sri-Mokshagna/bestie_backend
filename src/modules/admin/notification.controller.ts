import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { User, UserRole } from '../../models/User';
import { pushNotificationService } from '../../services/pushNotificationService';
import { notificationService } from '../../lib/notification';
import { NotificationType } from '../../models/Notification';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';
import { logger } from '../../lib/logger';

/**
 * Admin Notification Controller
 * Handles sending push notifications to users
 */

/**
 * Send notification to all users
 */
export const sendBroadcastNotification = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { title, body, targetRole, data } = req.body;

  if (!title || !body) {
    throw new AppError(400, 'Title and body are required');
  }

  // Build query based on target role
  const query: any = { status: 'active' };
  if (targetRole && targetRole !== 'all') {
    query.role = targetRole;
  }

  // Get all users with FCM tokens
  const users = await User.find({
    ...query,
    fcmToken: { $exists: true, $nin: [null, ''] },
  }).select('_id fcmToken profile.name role').lean();

  logger.info({
    totalUsers: users.length,
    targetRole: targetRole || 'all',
    title,
  }, '📢 Sending broadcast notification');

  let successCount = 0;
  let failCount = 0;

  // Prepare announcement notification data
  const timestamp = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const notificationData = {
    type: 'announcement',
    title,
    message: body,
    timestamp,
    ...data,
  };

  // Send notifications in batches
  const batchSize = 50;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    const promises = batch.map(async (user) => {
      try {
        // Send push notification with announcement type
        const pushSent = await pushNotificationService.sendNotification(
          user.fcmToken,
          title,
          body,
          notificationData
        );

        // Save to database (in-app notification)
        await notificationService.sendNotification(
          user._id.toString(),
          NotificationType.GENERAL,
          title,
          body,
          { ...notificationData, broadcast: true }
        );

        if (pushSent) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
        logger.error({ error, userId: user._id }, 'Failed to send notification to user');
      }
    });

    await Promise.all(promises);
  }

  logger.info({ successCount, failCount }, '✅ Broadcast notification complete');

  res.json({
    message: 'Broadcast notification sent',
    stats: {
      totalTargeted: users.length,
      successCount,
      failCount,
    },
  });
});

/**
 * Send notification to a specific user
 */
export const sendUserNotification = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { userId } = req.params;
  const { title, body, data } = req.body;

  if (!title || !body) {
    throw new AppError(400, 'Title and body are required');
  }

  const user = await User.findById(userId).select('fcmToken profile.name');
  if (!user) {
    throw new AppError(404, 'User not found');
  }

  // Send push notification if FCM token exists
  let pushSent = false;
  if (user.fcmToken) {
    pushSent = await pushNotificationService.sendNotification(
      user.fcmToken,
      title,
      body,
      data || {}
    );
  }

  // Save to database
  await notificationService.sendNotification(
    userId,
    NotificationType.GENERAL,
    title,
    body,
    data || {}
  );

  res.json({
    message: 'Notification sent',
    pushSent,
    userName: user.profile?.name || 'User',
  });
});

/**
 * Get notification stats
 */
export const getNotificationStats = asyncHandler(async (req: AuthRequest, res: Response) => {
  // Count users with FCM tokens
  const usersWithTokens = await User.countDocuments({
    status: 'active',
    fcmToken: { $exists: true, $nin: [null, ''] },
  });

  const totalActiveUsers = await User.countDocuments({ status: 'active' });

  const usersByRole = await User.aggregate([
    { $match: { status: 'active', fcmToken: { $exists: true, $nin: [null, ''] } } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);

  const roleStats: Record<string, number> = {};
  usersByRole.forEach((r) => {
    roleStats[r._id] = r.count;
  });

  res.json({
    totalActiveUsers,
    usersWithPushEnabled: usersWithTokens,
    coverage: totalActiveUsers > 0 ? Math.round((usersWithTokens / totalActiveUsers) * 100) : 0,
    byRole: roleStats,
  });
});
