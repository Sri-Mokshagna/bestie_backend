import crypto from 'crypto';
import { Call, CallType, CallStatus } from '../../models/Call';
import { User } from '../../models/User';
import { Chat, Message, MessageType } from '../../models/Chat';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../lib/logger';
import { emitToUser } from '../../lib/socket';
import { coinService } from '../../services/coinService';

// Make call metering optional based on Redis availability
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

async function getCallMeteringQueue() {
  if (!REDIS_ENABLED) {
    logger.debug('Call metering disabled - Redis not enabled');
    return null;
  }
  try {
    const mod = await import('../../jobs/callMetering');
    return mod.callMeteringQueue as any;
  } catch (error) {
    logger.warn({ error: error.message }, 'Call metering disabled - Redis not available');
    return null;
  }
}

export const callService = {
  async initiateCall(userId: string, responderId: string, type: CallType) {
    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Check if call type is enabled
    const featureName = type === CallType.AUDIO ? 'audioCall' : 'videoCall';
    const isEnabled = await coinService.isFeatureEnabled(featureName);
    if (!isEnabled) {
      throw new AppError(403, `${type} calls are currently disabled`, 'FEATURE_DISABLED');
    }

    // Check if user has sufficient coins for at least 1 minute
    const rate = await coinService.getCallRate(type === CallType.AUDIO ? 'audio' : 'video');
    if (user.coinBalance < rate) {
      throw new AppError(400, 'Insufficient coins for call. Please purchase more coins.', 'INSUFFICIENT_COINS');
    }

    // Find responder user (responderId is the User._id with role 'responder')
    const responderUser = await User.findById(responderId);

    if (!responderUser) {
      throw new AppError(404, 'Responder not found');
    }

    if (responderUser.role !== 'responder') {
      throw new AppError(400, 'User is not a responder');
    }

    // TODO: Add isOnline check when implemented
    // if (!responderUser.isOnline) {
    //   throw new AppError(400, 'Responder is offline');
    // }

    // Check if responder is already on a call
    const activeCall = await Call.findOne({
      responderId: responderUser._id,
      status: { $in: [CallStatus.RINGING, CallStatus.ACTIVE] },
    });

    if (activeCall) {
      // Auto-mark old ringing calls as missed (older than 60 seconds)
      const now = new Date();
      const callAge = now.getTime() - activeCall.createdAt.getTime();

      if (activeCall.status === CallStatus.RINGING && callAge > 60000) {
        // Mark as missed and allow new call
        activeCall.status = CallStatus.MISSED;
        activeCall.endTime = now;
        await activeCall.save();
      } else {
        throw new AppError(400, 'Responder is busy');
      }
    }

    // Generate ZEGOCLOUD room ID
    const zegoRoomId = this.generateRoomId();

    // Create call record
    const call = await Call.create({
      userId,
      responderId: responderUser._id,
      type,
      zegoRoomId,
      status: CallStatus.RINGING,
    });

    // Get names for display
    const callerName = user.profile?.name || user.phone || 'Unknown';
    const receiverName = responderUser.profile?.name || responderUser.phone || 'Responder';

    // Emit socket event to responder for real-time notification
    emitToUser(responderUser._id.toString(), 'incoming_call', {
      id: String(call._id),
      userId: call.userId.toString(),
      responderId: call.responderId.toString(),
      type: call.type,
      status: call.status,
      zegoRoomId: call.zegoRoomId,
      createdAt: call.createdAt,
      callerName,
      receiverName,
    });

    // TODO: Send push notification to responder (for when app is in background)

    return call;
  },

  async acceptCall(callId: string, responderId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.responderId.toString() !== responderId) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status !== CallStatus.RINGING) {
      throw new AppError(400, 'Call is not in ringing state');
    }

    // Update call status to CONNECTING (not ACTIVE yet)
    call.status = CallStatus.CONNECTING;
    await call.save();

    // Notify caller that call was accepted and is connecting
    emitToUser(call.userId.toString(), 'call_accepted', {
      callId: String(call._id),
      status: 'connecting',
    });

    // Don't start metering yet - wait for both parties to connect
    // Metering will start when call moves to ACTIVE status

    return call;
  },

  async confirmCallConnection(callId: string, userId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.userId.toString() !== userId && call.responderId.toString() !== userId) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status !== CallStatus.CONNECTING) {
      throw new AppError(400, 'Call is not in connecting state');
    }

    // Update call status to ACTIVE and start timer
    call.status = CallStatus.ACTIVE;
    call.startTime = new Date();
    await call.save();

    // Notify both parties that call is now active
    emitToUser(call.userId.toString(), 'call_connected', {
      callId: String(call._id),
    });
    emitToUser(call.responderId.toString(), 'call_connected', {
      callId: String(call._id),
    });

    // Start metering job (if Redis is enabled) - Fire and forget, don't block call flow
    this.startCallMetering(String(call._id)).catch(err => {
      logger.warn({ error: err.message, callId: String(call._id) }, 'Failed to start call metering in background');
    });

    return call;
  },

  // Helper method to start metering asynchronously
  async startCallMetering(callId: string) {
    try {
      // Add a timeout to getting the queue to prevent hanging
      const queuePromise = getCallMeteringQueue();
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));

      const queue = await Promise.race([queuePromise, timeoutPromise]);

      if (queue) {
        await queue.add(
          'meter-call',
          { callId },
          {
            repeat: {
              every: 30000, // Every 30 seconds
            },
            jobId: `meter-${callId}`,
            removeOnComplete: true,
            removeOnFail: true,
          }
        );
        logger.info({ callId }, 'Call metering started');
      } else {
        logger.info({ callId }, 'Call metering disabled or timed out - continuing without metering');
      }
    } catch (error) {
      logger.warn({ error: error.message, callId }, 'Failed to start call metering - continuing without metering');
      // Don't throw error - call should continue even if metering fails
    }
  },

  async handleCallConnectionFailure(callId: string, userId: string, reason: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.userId.toString() !== userId && call.responderId.toString() !== userId) {
      throw new AppError(403, 'Not authorized');
    }

    // Mark call as ended due to connection failure
    call.status = CallStatus.ENDED;
    call.endTime = new Date();
    await call.save();

    // Notify both parties about connection failure
    emitToUser(call.userId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'connection_failed',
    });
    emitToUser(call.responderId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'connection_failed',
    });

    logger.warn({ callId, userId, reason }, 'Call connection failed');

    return call;
  },

  async rejectCall(callId: string, responderId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (call.responderId.toString() !== responderId) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status !== CallStatus.RINGING) {
      throw new AppError(400, 'Call is not in ringing state');
    }

    call.status = CallStatus.REJECTED;
    call.endTime = new Date();
    await call.save();

    // Notify caller that call was rejected
    emitToUser(call.userId.toString(), 'call_ended', {
      callId: String(call._id),
      reason: 'rejected',
    });

    // Create call history message for declined call
    await this.createCallMessage(call);

    return call;
  },

  async endCall(callId: string, userId: string) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    if (
      call.userId.toString() !== userId &&
      call.responderId.toString() !== userId
    ) {
      throw new AppError(403, 'Not authorized');
    }

    if (call.status === CallStatus.ENDED) {
      throw new AppError(400, 'Call already ended');
    }

    // Stop metering job (if Redis is enabled) - Don't let this fail the call ending
    try {
      const queue = await getCallMeteringQueue();
      if (queue) {
        await queue.removeRepeatableByKey(`meter-${String(call._id)}`);
        logger.info({ callId: String(call._id) }, 'Call metering stopped');
      }
    } catch (error) {
      logger.warn({ error: error.message, callId: String(call._id) }, 'Failed to stop call metering - call ended anyway');
      // Don't throw error - call should end even if metering cleanup fails
    }

    // Calculate duration
    if (call.startTime) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - call.startTime.getTime();
      call.durationSeconds = Math.floor(durationMs / 1000);
      call.endTime = endTime;
    }

    call.status = CallStatus.ENDED;
    await call.save();

    // Create call history message in chat
    await this.createCallMessage(call);

    // Emit socket event to both parties that call has ended
    emitToUser(call.userId.toString(), 'call_ended', {
      callId: String(call._id),
    });
    emitToUser(call.responderId.toString(), 'call_ended', {
      callId: String(call._id),
    });

    return call;
  },

  async getCallStatus(callId: string) {
    const call = await Call.findById(callId)
      .populate('userId', 'profile phone')
      .populate('responderId', 'userId rating');

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    return call;
  },

  async getCallLogs(userId: string, partnerId: string) {
    // Find all calls between user and partner
    const calls = await Call.find({
      $or: [
        { userId: userId, responderId: partnerId },
        { userId: partnerId, responderId: userId },
      ],
      status: { $in: [CallStatus.ENDED, CallStatus.REJECTED, CallStatus.MISSED] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Format calls with string IDs
    return calls.map(call => ({
      id: String(call._id),
      userId: call.userId.toString(),
      responderId: call.responderId.toString(),
      type: call.type,
      status: call.status,
      startTime: call.startTime,
      endTime: call.endTime,
      durationSeconds: call.durationSeconds,
      coinsCharged: call.coinsCharged,
      createdAt: call.createdAt,
    }));
  },

  async getCallHistory(userId: string) {
    // Find all calls where user was involved (as user or responder)
    const calls = await Call.find({
      $or: [
        { userId: userId },
        { responderId: userId },
      ],
      status: { $in: [CallStatus.ENDED, CallStatus.REJECTED, CallStatus.MISSED] },
    })
      .populate('userId', 'profile phone')
      .populate('responderId', 'profile phone')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Format calls with populated user data
    return calls.map(call => ({
      id: String(call._id),
      userId: call.userId._id.toString(),
      responderId: call.responderId._id.toString(),
      user: call.userId,
      responder: call.responderId,
      type: call.type,
      status: call.status,
      startTime: call.startTime,
      endTime: call.endTime,
      duration: call.durationSeconds || 0,
      coinsCharged: call.coinsCharged,
      createdAt: call.createdAt,
    }));
  },

  async updateCallDuration(callId: string, durationSeconds: number) {
    const call = await Call.findById(callId);

    if (!call) {
      throw new AppError(404, 'Call not found');
    }

    call.durationSeconds = durationSeconds;

    // If call is still active, mark as ended
    if (call.status === CallStatus.ACTIVE) {
      call.status = CallStatus.ENDED;
      call.endTime = new Date();
    }

    await call.save();

    return call;
  },

  generateRoomId(): string {
    return `room_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  },

  async cleanupStaleCalls() {
    const now = new Date();
    const sixtySecondsAgo = new Date(now.getTime() - 60000);

    // Find old ringing calls to mark as missed
    const ringingCalls = await Call.find({
      status: CallStatus.RINGING,
      createdAt: { $lt: sixtySecondsAgo },
    });

    // Mark old ringing calls as missed and create messages
    for (const call of ringingCalls) {
      call.status = CallStatus.MISSED;
      call.endTime = now;
      await call.save();
      await this.createCallMessage(call);
    }

    // Mark old active calls as ended (shouldn't happen, but just in case)
    const activeResult = await Call.updateMany(
      {
        status: CallStatus.ACTIVE,
        startTime: { $lt: sixtySecondsAgo },
      },
      {
        $set: {
          status: CallStatus.ENDED,
          endTime: now,
        },
      }
    );

    return {
      ringingCallsCleaned: ringingCalls.length,
      activeCallsCleaned: activeResult.modifiedCount,
    };
  },

  generateZegoToken(userId: string, roomId: string): string {
    try {
      const { generateZegoToken, getZegoConfig } = require('../../lib/zegoToken');
      const zegoConfig = getZegoConfig();

      return generateZegoToken({
        appId: zegoConfig.appId,
        serverSecret: zegoConfig.serverSecret,
        userId,
        roomId,
        expireTimeInSeconds: 3600 // 1 hour
      });
    } catch (error) {
      logger.error({ error, userId, roomId }, 'Failed to generate ZEGO token');
      // Return a fallback token for development
      return `dev_token_${userId}_${roomId}_${Date.now()}`;
    }
  },

  async createCallMessage(call: any) {
    try {
      // Find or create chat between user and responder
      let chat = await Chat.findOne({
        participants: { $all: [call.userId, call.responderId] },
      });

      if (!chat) {
        chat = await Chat.create({
          participants: [call.userId, call.responderId],
          lastMessageAt: new Date(),
        });
      }

      // Determine call status for message
      let status: 'completed' | 'missed' | 'declined';
      let content: string;

      if (call.status === CallStatus.ENDED) {
        status = 'completed';
        const duration = call.durationSeconds || 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        content = `${call.type} call ${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;
      } else if (call.status === CallStatus.REJECTED) {
        status = 'declined';
        content = `${call.type} call declined`;
      } else if (call.status === CallStatus.MISSED) {
        status = 'missed';
        content = `Missed ${call.type} call`;
      } else {
        return; // Don't create message for other statuses
      }

      // Create call message
      const message = await Message.create({
        chatId: chat._id,
        senderId: call.userId,
        content,
        type: MessageType.CALL,
        metadata: {
          callType: call.type,
          duration: call.durationSeconds || 0,
          status,
          callId: String(call._id),
        },
        coinsCharged: 0,
      });

      // Update chat's last message time
      chat.lastMessageAt = new Date();
      await chat.save();

      logger.info({ msg: 'Created call history message', callId: String(call._id), messageId: String(message._id) });

      // Emit socket event for new message
      emitToUser(call.userId.toString(), 'new_message', {
        chatId: String(chat._id),
        message: {
          id: String(message._id),
          chatId: String(message.chatId),
          senderId: String(message.senderId),
          content: message.content,
          type: message.type,
          metadata: message.metadata,
          createdAt: message.createdAt,
          readAt: message.readAt,
        },
      });

      emitToUser(call.responderId.toString(), 'new_message', {
        chatId: String(chat._id),
        message: {
          id: String(message._id),
          chatId: String(message.chatId),
          senderId: String(message.senderId),
          content: message.content,
          type: message.type,
          metadata: message.metadata,
          createdAt: message.createdAt,
          readAt: message.readAt,
        },
      });

    } catch (error) {
      logger.error({ msg: 'Failed to create call message', error, callId: String(call._id) });
      // Don't throw - message creation is not critical
    }
  },
};
