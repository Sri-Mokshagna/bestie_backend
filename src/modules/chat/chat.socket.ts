import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { Chat, Message } from '../../models/Chat';
import { User, UserRole } from '../../models/User';
import { Responder } from '../../models/Responder';
import { coinService } from '../../services/coinService';
import { logger } from '../../lib/logger';
import { getAuth } from 'firebase-admin/auth';
import { pushNotificationService } from '../../services/pushNotificationService';

interface AuthSocket extends Socket {
  userId?: string;
}

export function initializeChatSocket(io: SocketServer) {
  // Authentication middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        logger.warn({ msg: 'Socket connection attempt without token' });
        return next(new Error('Authentication error'));
      }

      // Verify Firebase ID token
      const decodedToken = await getAuth().verifyIdToken(token);
      const firebaseUid = decodedToken.uid;

      // Find user by Firebase UID
      console.log('🔍 Socket auth: Looking up user by firebaseUid:', firebaseUid);
      const user = await User.findOne({ firebaseUid });

      if (!user) {
        // Try to find by phone number as fallback
        const phoneNumber = decodedToken.phone_number;
        console.log('⚠️  User not found by firebaseUid, trying phone:', phoneNumber);

        if (phoneNumber) {
          const userByPhone = await User.findOne({ phone: phoneNumber });
          if (userByPhone) {
            console.log('✅ Found user by phone, updating firebaseUid');
            userByPhone.firebaseUid = firebaseUid;
            await userByPhone.save();
            socket.userId = userByPhone._id.toString();
            logger.info({ msg: 'Socket authenticated (via phone lookup)', userId: socket.userId });
            return next();
          }
        }

        logger.warn({ msg: 'Socket auth failed: User not found', firebaseUid, phone: phoneNumber });
        return next(new Error('Authentication error'));
      }

      socket.userId = user._id.toString();
      logger.info({ msg: 'Socket authenticated', userId: socket.userId });
      next();
    } catch (error: any) {
      logger.error({ msg: 'Socket authentication error', error: error.message, code: error.code });

      // Check if it's a token expiration error
      if (error.code === 'auth/id-token-expired') {
        logger.warn({ msg: 'Firebase ID token expired during socket authentication' });
        return next(new Error('Firebase ID token expired. Please refresh your token and reconnect.'));
      }

      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket: AuthSocket) => {
    logger.info(`User ${socket.userId} connected to chat (socket: ${socket.id})`);

    // Join user's personal room for call notifications
    // Multiple devices for same user can connect simultaneously
    if (socket.userId) {
      socket.join(`user_${socket.userId}`);
      logger.info(`User ${socket.userId} joined personal room (socket: ${socket.id})`);
    }

    socket.on('join_room', async ({ roomId }) => {
      try {
        // Verify user is participant
        const chat = await Chat.findById(roomId);
        if (!chat) {
          socket.emit('error', { message: 'Chat not found' });
          return;
        }

        const isParticipant = chat.participants.some(
          (p) => p.toString() === socket.userId
        );

        if (!isParticipant) {
          socket.emit('error', { message: 'Not authorized' });
          return;
        }

        socket.join(roomId);
        logger.info(`User ${socket.userId} joined room ${roomId}`);
      } catch (error) {
        logger.error(`Join room error: ${error}`);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('leave_room', ({ roomId }) => {
      socket.leave(roomId);
      logger.info(`User ${socket.userId} left room ${roomId}`);
    });

    // CRITICAL: Add callback for acknowledgment (confirms to client)
    socket.on('send_message', async ({ roomId, body }, callback) => {
      try {
        // CRITICAL: Validate authentication
        // SILENT FAILURE: If not authenticated, log server-side only, don't respond to client
        // This prevents "Authentication error" from showing to users
        // Client will timeout and retry, token refresh will happen automatically in background
        if (!socket.userId) {
          logger.error({
            msg: 'Send message: Not authenticated - silently ignoring (client will retry)',
            socketId: socket.id,
            timestamp: new Date().toISOString()
          });
          // DO NOT call callback - let client timeout and retry with fresh token
          return;
        }

        // CRITICAL: Validate input
        if (!roomId || !body) {
          logger.error({
            msg: 'Send message: Missing required fields',
            userId: socket.userId,
            hasRoomId: !!roomId,
            hasBody: !!body
          });
          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        // CRITICAL: Validate body is non-empty string
        if (typeof body !== 'string' || body.trim().length === 0) {
          logger.error({
            msg: 'Send message: Invalid message body',
            userId: socket.userId,
            bodyType: typeof body,
            bodyLength: typeof body === 'string' ? body.length : 0
          });
          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        logger.info({
          msg: '📤 Processing new message',
          userId: socket.userId,
          roomId,
          messageLength: body.length,
        });

        // PERFORMANCE: Run initial validations in parallel
        const [chat, chatEnabled] = await Promise.all([
          Chat.findById(roomId).lean(),
          coinService.isFeatureEnabled('chat'),
        ]);

        if (!chat) {
          logger.error({
            msg: 'Send message: Chat not found',
            userId: socket.userId,
            roomId
          });
          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        const isParticipant = chat.participants.some(
          (p: any) => p.toString() === socket.userId
        );

        if (!isParticipant) {
          logger.error({
            msg: 'Send message: User not a participant',
            userId: socket.userId,
            roomId,
            participants: chat.participants.map((p: any) => p.toString()),
          });
          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        // Get the other participant (recipient)
        const recipientId = chat.participants.find(
          (p: any) => p.toString() !== socket.userId
        );

        if (!recipientId) {
          logger.error({ msg: 'Recipient not found', userId: socket.userId, roomId });
          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        // Check if chat is enabled
        if (!chatEnabled) {
          logger.warn({ msg: 'Chat feature disabled', userId: socket.userId });
          if (callback) callback({ success: false, error: 'Chat is currently disabled.' });
          return;
        }

        // Deduct coins and get config
        let result;
        try {
          logger.info({
            msg: 'Attempting coin deduction',
            userId: socket.userId,
            recipientId: recipientId.toString(),
            roomId,
          });

          result = await coinService.deductForChat(
            socket.userId,     // sender
            recipientId.toString(),  // recipient
            roomId
          );

          logger.info({
            msg: '✅ Coins deducted successfully',
            balance: result.balance,
            coinsDeducted: result.coinsDeducted,
          });

          // NOTE: deductForChat throws error if insufficient coins,
          // so if we reach here, deduction was successful
        } catch (error: any) {
          logger.error({
            msg: '❌ Coin deduction error',
            error: error.message,
            code: error.code,
            userId: socket.userId,
            stack: error.stack,
          });

          if (error.code === 'INSUFFICIENT_COINS') {
            if (callback) callback({ success: false, error: 'Insufficient coins. Please recharge.' });
            return;
          }

          if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
          return;
        }

        // Create message
        const message = await Message.create({
          chatId: new Types.ObjectId(roomId),
          senderId: new Types.ObjectId(socket.userId),
          content: body,
          type: 'text',
          coinsCharged: result.coinsDeducted,
        });

        // PERFORMANCE: Format message immediately without populate (we know the senderId)
        // This saves a DB query and speeds up message delivery
        const fastMessage = {
          id: message._id.toString(),
          _id: message._id.toString(),
          chatId: message.chatId.toString(),
          senderId: message.senderId.toString(),
          content: message.content,
          type: message.type || 'text',
          coinsCharged: message.coinsCharged,
          createdAt: message.createdAt,
        };

        // PERFORMANCE: Emit to room IMMEDIATELY (don't wait for chat.save)
        io.to(roomId).emit('new_message', fastMessage);

        // CRITICAL: Send success acknowledgment to sender
        if (callback) callback({ success: true, messageId: message._id.toString() });

        // Send updated balance to sender immediately
        socket.emit('coin_balance_updated', {
          balance: result.balance,
          coinsDeducted: result.coinsDeducted,
        });

        // BACKGROUND: Update chat lastMessageAt (non-blocking)
        Chat.updateOne(
          { _id: roomId },
          { lastMessageAt: new Date() }
        ).exec().catch(err => {
          logger.error(`Failed to update chat lastMessageAt: ${err}`);
        });

        // PUSH NOTIFICATION: Send push notification to recipient if they're NOT in the chat room
        // This ensures they get notified even if app is in background or closed
        // Skip notification if recipient is actively in the room (they'll see message via socket)
        try {
          const recipientIdStr = recipientId.toString();

          // Check if recipient is in the room (actively viewing chat)
          // NOTE: When app goes to background, ChatScreen calls leaveRoom() to remove from room
          // This ensures we send push notifications for background apps
          const recipientSockets = await io.in(roomId).fetchSockets();
          const isRecipientInRoom = recipientSockets.some((s: any) => s.userId === recipientIdStr);

          logger.info({
            msg: 'Chat notification check',
            recipientId: recipientIdStr,
            isRecipientInRoom,
            roomId,
            senderId: socket.userId,
            socketsInRoom: recipientSockets.length,
          });

          // Only send push notification if recipient is NOT in the room
          if (!isRecipientInRoom) {
            const [recipient, sender] = await Promise.all([
              User.findById(recipientId).select('fcmToken profile phone role').lean(),
              User.findById(socket.userId).select('profile phone role').lean(),
            ]);

            logger.info({
              msg: 'Sending chat push notification',
              recipientId: recipientIdStr,
              recipientRole: recipient?.role,
              hasFcmToken: !!recipient?.fcmToken,
              senderRole: sender?.role,
            });

            if (recipient?.fcmToken) {
              const senderName = sender?.profile?.name || sender?.phone || 'Someone';

              // Send push notification for new message
              const notificationResult = await pushNotificationService.sendNotification(
                recipient.fcmToken,
                'New Message',
                `${senderName}: ${body.length > 50 ? body.substring(0, 50) + '...' : body}`,
                {
                  type: 'new_message',
                  chatId: roomId,
                  senderId: socket.userId!,
                  senderName: senderName,
                  messagePreview: body.length > 100 ? body.substring(0, 100) : body,
                }
              );

              logger.info({
                msg: 'Chat notification sent result',
                recipientId: recipientIdStr,
                success: notificationResult,
                recipientRole: recipient.role,
              });
            } else {
              logger.warn({
                msg: 'Cannot send chat notification - no FCM token',
                recipientId: recipientIdStr,
                recipientRole: recipient?.role,
                recipientExists: !!recipient,
              });
            }
          } else {
            logger.debug(`Recipient ${recipientIdStr} is in room (${recipientSockets.length} sockets) - skipping push notification`);
          }
        } catch (notifError) {
          // Non-blocking - don't fail message send if notification fails
          logger.error({
            msg: 'Failed to send chat notification',
            error: notifError,
            recipientId: recipientId.toString(),
            stack: (notifError as Error).stack,
          });
        }

        logger.info(
          `Message sent in room ${roomId} by user ${socket.userId}, coins deducted: ${result.coinsDeducted}`
        );
      } catch (error) {
        logger.error({
          msg: '❌ Send message error',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          userId: socket.userId,
          roomId,
        });

        if (callback) callback({ success: false, error: 'Failed to send message. Please try again.' });
      }
    });

    socket.on('typing', ({ roomId }) => {
      socket.to(roomId).emit('typing', { userId: socket.userId });
    });

    // Listen for responder availability updates and broadcast to all connected users
    socket.on('responder_availability_update', async (data) => {
      try {
        logger.info({ msg: 'Responder availability update received', data, socketId: socket.id });

        // Broadcast to ALL connected sockets except the sender
        // This ensures all users see the real-time availability change
        socket.broadcast.emit('responder_availability_update', {
          responderId: data.responderId,
          audioEnabled: data.audioEnabled,
          videoEnabled: data.videoEnabled,
          chatEnabled: data.chatEnabled,
          isOnline: data.audioEnabled || data.videoEnabled || data.chatEnabled,
        });

        logger.info({ msg: 'Availability update broadcasted', responderId: data.responderId });
      } catch (error) {
        logger.error({ msg: 'Error broadcasting availability update', error });
      }
    });

    socket.on('disconnect', async () => {
      logger.info(`User ${socket.userId} disconnected from chat (socket: ${socket.id})`);

      // AUTO-OFFLINE: Set responders offline when they disconnect
      if (socket.userId) {
        try {
          const user = await User.findById(socket.userId);

          if (user && user.role === UserRole.RESPONDER) {
            // Update User model - set offline and reset inCall
            user.isOnline = false;
            user.inCall = false; // Reset inCall in case they were in a call
            user.lastOnlineAt = new Date();
            await user.save();

            // Update Responder model - set offline and reset inCall
            await Responder.findOneAndUpdate(
              { userId: socket.userId },
              {
                isOnline: false,
                inCall: false, // Reset inCall in case they were in a call
                lastOnlineAt: new Date()
              }
            );

            logger.info(`Auto-offline: Responder ${socket.userId} (${user.profile?.name || user.phone}) set to offline on disconnect`);
          }
        } catch (error) {
          logger.error(`Auto-offline error for user ${socket.userId}: ${error}`);
        }
      }
    });
  });

  return io;
}
