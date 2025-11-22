import { Queue, Worker } from 'bullmq';
import redis, { bullmqRedis } from '../lib/redis';
import { Call, CallType, CallStatus } from '../models/Call';
import { User } from '../models/User';
import { coinService } from '../services/coinService';
import { logger } from '../lib/logger';
import { emitToUser } from '../lib/socket';

const TICK_INTERVAL_SECONDS = 30;

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

let callMeteringQueue: Queue | undefined;
let callMeteringWorker: Worker | undefined;

if (REDIS_ENABLED && bullmqRedis) {
  callMeteringQueue = new Queue('call-metering', {
    connection: bullmqRedis as any,
  });

  callMeteringWorker = new Worker(
    'call-metering',
    async (job) => {
      const { callId } = job.data;

      try {
        const call = await Call.findById(callId);

        if (!call || (call.status !== CallStatus.ACTIVE && call.status !== CallStatus.CONNECTING)) {
          // Call ended or not active, remove repeatable job
          if (callMeteringQueue) {
            await callMeteringQueue.removeRepeatableByKey(job.repeatJobKey!);
          }
          return { status: 'stopped', reason: 'call_not_active' };
        }

        // Skip metering if call is still connecting
        if (call.status === CallStatus.CONNECTING) {
          return { status: 'waiting', reason: 'call_connecting' };
        }

        const user = await User.findById(call.userId);
        if (!user) {
          throw new Error('User not found');
        }

        // Deduct coins for this tick
        const callType = call.type === CallType.AUDIO ? 'audio' : 'video';
        const result = await coinService.deductForCall(
          callId.toString(),
          call.userId.toString(),
          call.responderId.toString(),
          callType,
          TICK_INTERVAL_SECONDS
        );

        // Check if call should continue
        if (!result.shouldContinue) {
          // Insufficient balance, end call
          logger.info(`Call ${callId}: Insufficient balance, ending call`);

          if (callMeteringQueue) {
            await callMeteringQueue.removeRepeatableByKey(job.repeatJobKey!);
          }

          call.status = CallStatus.ENDED;
          call.endTime = new Date();
          if (call.startTime) {
            const durationMs = call.endTime.getTime() - call.startTime.getTime();
            call.durationSeconds = Math.floor(durationMs / 1000);
          }
          await call.save();

          // Emit socket event to notify both parties
          emitToUser(call.userId.toString(), 'call_ended', {
            callId: callId.toString(),
            reason: 'insufficient_coins',
          });
          emitToUser(call.responderId.toString(), 'call_ended', {
            callId: callId.toString(),
            reason: 'insufficient_coins',
          });

          return { status: 'ended', reason: 'insufficient_balance' };
        }

        // Update call with live meter info
        await Call.findByIdAndUpdate(callId, {
          $inc: { coinsCharged: result.coinsDeducted },
          $set: {
            'liveMeter.lastTick': new Date(),
            'liveMeter.remainingBalance': result.balance,
          },
        });

        logger.info(
          `Call ${callId}: Charged ${result.coinsDeducted} coins, remaining: ${result.balance}`
        );

        // Emit socket event with updated balance to user only
        emitToUser(call.userId.toString(), 'call_coin_update', {
          callId: callId.toString(),
          balance: result.balance,
          coinsDeducted: result.coinsDeducted,
        });

        return {
          status: 'metered',
          coinsCharged: result.coinsDeducted,
          remainingBalance: result.balance,
        };
      } catch (error) {
        logger.error({ error, callId }, 'Call metering error');
        throw error;
      }
    },
    {
      connection: bullmqRedis as any,
      concurrency: 10,
    }
  );

  callMeteringWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id, result: job.returnvalue }, 'Job completed');
  });

  callMeteringWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });
} else {
  logger.warn('Call metering jobs are disabled (Redis not enabled).');
}

export { callMeteringQueue, callMeteringWorker };
