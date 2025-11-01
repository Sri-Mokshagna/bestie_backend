import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { Chat, Message } from '../../models/Chat';
import { User } from '../../models/User';
import { walletService } from '../wallet/wallet.service';
import { TransactionType } from '../../models/Transaction';
import { logger } from '../../lib/logger';

const CHAT_COINS_PER_MESSAGE = parseInt(
  process.env.CHAT_COINS_PER_MESSAGE || '3',
  10
);

interface AuthSocket extends Socket {
  userId?: string;
}

export function initializeChatSocket(io: SocketServer) {
  // Authentication middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication error'));
      }

      const secret = process.env.JWT_SECRET!;
      const decoded = jwt.verify(token, secret) as { id: string };

      socket.userId = decoded.id;
      next();
    } catch (error) {
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

        // Check user balance
        const user = await User.findById(socket.userId);
        if (!user) {
          socket.emit('error', { message: 'User not found' });
          return;
        }

        if (user.coinBalance < CHAT_COINS_PER_MESSAGE) {
          socket.emit('error', {
            message: 'Insufficient coins',
            code: 'INSUFFICIENT_COINS',
          });
          return;
        }

        // Deduct coins
        await walletService.deductCoins(
          socket.userId,
          CHAT_COINS_PER_MESSAGE,
          TransactionType.CHAT,
          undefined,
          { chatId: roomId }
        );

        // Create message
        const message = await Message.create({
          chatId: roomId,
          senderId: socket.userId,
          body,
          coinsCharged: CHAT_COINS_PER_MESSAGE,
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

        logger.info(
          `Message sent in room ${roomId} by user ${socket.userId}`
        );
      } catch (error) {
        logger.error(`Send message error: ${error}`);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    socket.on('typing', ({ roomId }) => {
      socket.to(roomId).emit('typing', { userId: socket.userId });
    });

    socket.on('disconnect', () => {
      logger.info(`User ${socket.userId} disconnected from chat`);
    });
  });

  return io;
}
