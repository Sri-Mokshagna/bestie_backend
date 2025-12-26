import { admin } from '../lib/firebase';
import { logger } from '../lib/logger';

/**
 * Push Notification Service for FCM
 * Handles sending push notifications via Firebase Cloud Messaging
 * 
 * NOTE: This is ADDITIVE to socket-based notifications.
 * If push fails, socket notifications still work for foreground apps.
 */
export const pushNotificationService = {
  /**
   * Send incoming call notification to a user
   * This is used when the app is in background/killed
   */
  async sendIncomingCallNotification(
    fcmToken: string,
    callData: {
      callId: string;
      callerId: string;
      callerName: string;
      callType: 'audio' | 'video';
      zegoRoomId: string;
    }
  ): Promise<boolean> {
    if (!fcmToken) {
      logger.debug('No FCM token provided, skipping push notification');
      return false;
    }

    try {
      const message = {
        token: fcmToken,
        // Data payload - always delivered even if app is killed
        data: {
          type: 'incoming_call',
          callId: callData.callId,
          callerId: callData.callerId,
          callerName: callData.callerName,
          callType: callData.callType,
          zegoRoomId: callData.zegoRoomId,
          // Timestamp for deduplication on client
          timestamp: Date.now().toString(),
        },
        // Notification payload - shows in notification tray
        notification: {
          title: `Incoming ${callData.callType} call`,
          body: `${callData.callerName} is calling you`,
        },
        // Android specific configuration
        android: {
          priority: 'high' as const,
          ttl: 30000, // 30 seconds - call times out anyway
          notification: {
            channelId: 'incoming_calls', // Must match Flutter channel
            priority: 'max' as const,
            sound: 'default',
            defaultVibrateTimings: true,
            visibility: 'public' as const,
            // Full-screen intent for incoming calls
            tag: callData.callId, // Prevents duplicate notifications
          },
        },
        // APNs (iOS) specific configuration
        apns: {
          headers: {
            'apns-priority': '10', // High priority
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              alert: {
                title: `Incoming ${callData.callType} call`,
                body: `${callData.callerName} is calling you`,
              },
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      logger.info({ callId: callData.callId, messageId: response }, 'Push notification sent successfully');
      return true;
    } catch (error: any) {
      // Don't throw - push notifications are best-effort
      // Socket notifications will still work for foreground apps
      if (error.code === 'messaging/registration-token-not-registered') {
        logger.warn({ fcmToken: fcmToken.substring(0, 20) + '...' }, 'FCM token invalid/expired');
      } else if (error.code === 'messaging/invalid-argument') {
        logger.warn({ error: error.message }, 'Invalid FCM message format');
      } else {
        logger.error({ error }, 'Failed to send push notification');
      }
      return false;
    }
  },

  /**
   * Send call ended notification (to dismiss any existing notifications)
   */
  async sendCallEndedNotification(fcmToken: string, callId: string): Promise<boolean> {
    if (!fcmToken) {
      return false;
    }

    try {
      const message = {
        token: fcmToken,
        data: {
          type: 'call_ended',
          callId: callId,
          timestamp: Date.now().toString(),
        },
        // Silent notification - no visible alert, just data
        android: {
          priority: 'high' as const,
          ttl: 5000, // 5 seconds
        },
      };

      await admin.messaging().send(message);
      logger.debug({ callId }, 'Call ended notification sent');
      return true;
    } catch (error) {
      // Silent failure - not critical
      return false;
    }
  },

  /**
   * Send a generic notification
   */
  async sendNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<boolean> {
    if (!fcmToken) {
      return false;
    }

    try {
      const message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
        android: {
          priority: 'high' as const,
        },
      };

      await admin.messaging().send(message);
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to send notification');
      return false;
    }
  },
};
