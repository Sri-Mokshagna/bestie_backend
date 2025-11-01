import crypto from 'crypto';
import { Call, CallType, CallStatus } from '../../models/Call';
import { User } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';
import { emitToUser } from '../../lib/socket';

// Make call metering optional based on Redis availability
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

async function getCallMeteringQueue() {
  if (!REDIS_ENABLED) return null;
  try {
    const mod = await import('../../jobs/callMetering');
    return mod.callMeteringQueue as any;
  } catch (error) {
    logger.warn({ msg: 'Call metering disabled - Redis not available' });
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

    // TODO: Re-enable coin checking when coins feature is ready
    // const minCoins = type === CallType.AUDIO ? 10 : 60;
    // if (user.coinBalance < minCoins) {
    //   throw new AppError(400, 'Insufficient coins for call');
    // }

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

    // Update call status
    call.status = CallStatus.ACTIVE;
    call.startTime = new Date();
    await call.save();

    // Notify caller that call was accepted
    emitToUser(call.userId.toString(), 'call_accepted', {
      callId: String(call._id),
    });

    // Start metering job (if Redis is enabled)
    const queue = await getCallMeteringQueue();
    if (queue) {
      await queue.add(
        'meter-call',
        { callId: String(call._id) },
        {
          repeat: {
            every: 30000, // Every 30 seconds
          },
          jobId: `meter-${String(call._id)}`,
        }
      );
    }

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
    await call.save();

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

    // Stop metering job (if Redis is enabled)
    const queue = await getCallMeteringQueue();
    if (queue) {
      await queue.removeRepeatableByKey(`meter-${String(call._id)}`);
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

    // Mark old ringing calls as missed
    const ringingResult = await Call.updateMany(
      {
        status: CallStatus.RINGING,
        createdAt: { $lt: sixtySecondsAgo },
      },
      {
        $set: {
          status: CallStatus.MISSED,
          endTime: now,
        },
      }
    );

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
      ringingCallsCleaned: ringingResult.modifiedCount,
      activeCallsCleaned: activeResult.modifiedCount,
    };
  },

  generateZegoToken(userId: string, roomId: string): string {
    // TODO: Implement actual ZEGOCLOUD token generation
    // This requires ZEGO_APP_ID and ZEGO_SERVER_SECRET
    // For now, return a placeholder
    return `token_${userId}_${roomId}`;
  },
};
