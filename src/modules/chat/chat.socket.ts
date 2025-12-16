import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Chat, Message } from '../../models/Chat';
import { User, UserRole } from '../../models/User';
import { Responder } from '../../models/Responder';
import { coinService } from '../../services/coinService';
import { logger } from '../../lib/logger';
import { getAuth } from 'firebase-admin/auth';

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
    } catch (error) {
      logger.error({ msg: 'Socket authentication error', error });
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

    socket.on('send_message', async ({ roomId, body }) => {
      try {
        if (!socket.userId) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // Verify chat exists and user is participant
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

        // Get the other participant (responder)
        const responderId = chat.participants.find(
          (p) => p.toString() !== socket.userId
        );

        if (!responderId) {
          socket.emit('error', { message: 'Responder not found' });
          return;
        }

        // Check if chat is enabled
        const chatEnabled = await coinService.isFeatureEnabled('chat');
        if (!chatEnabled) {
          socket.emit('error', {
            message: 'Chat feature is currently disabled',
            code: 'FEATURE_DISABLED',
          });
          return;
        }

        // Deduct coins and get config
        let result;
        try {
          result = await coinService.deductForChat(
            socket.userId,
            responderId.toString(),
            roomId
          );
        } catch (error: any) {
          if (error.code === 'INSUFFICIENT_COINS') {
            socket.emit('error', {
              message: 'No coins left. Please purchase more coins to continue chatting.',
              code: 'INSUFFICIENT_COINS',
            });
            return;
          }
          throw error;
        }

        // Create message
        const message = await Message.create({
          chatId: roomId,
          senderId: socket.userId,
          content: body,
          type: 'text',
          coinsCharged: result.coinsDeducted,
        });

        // Update chat last message time
        chat.lastMessageAt = new Date();
        await chat.save();

        // Populate sender info
        const populatedMessage = await Message.findById(message._id)
          .populate('senderId', 'profile phone')
          .lean();

        // Broadcast to room
        io.to(roomId).emit('new_message', populatedMessage);

        // Send updated balance to sender
        socket.emit('coin_balance_updated', {
          balance: result.balance,
          coinsDeducted: result.coinsDeducted,
        });

        logger.info(
          `Message sent in room ${roomId} by user ${socket.userId}, coins deducted: ${result.coinsDeducted}`
        );
      } catch (error) {
        logger.error(`Send message error: ${error}`);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing', ({ roomId }) => {
      socket.to(roomId).emit('typing', { userId: socket.userId });
    });

    socket.on('disconnect', async () => {
      logger.info(`User ${socket.userId} disconnected from chat (socket: ${socket.id})`);
      
      // AUTO-OFFLINE: Set responders offline when they disconnect
      if (socket.userId) {
        try {
          const user = await User.findById(socket.userId);
          
          if (user && user.role === UserRole.RESPONDER) {
            // Update User model
            user.isOnline = false;
            user.lastOnlineAt = new Date();
            await user.save();
            
            // Update Responder model
            await Responder.findOneAndUpdate(
              { userId: socket.userId },
              { 
                isOnline: false,
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
