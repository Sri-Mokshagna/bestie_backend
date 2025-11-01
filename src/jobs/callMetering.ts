import { Queue, Worker } from 'bullmq';
import redis from '../lib/redis';
import { Call, CallType, CallStatus } from '../models/Call';
import { User } from '../models/User';
import { Responder } from '../models/Responder';
import { walletService } from '../modules/wallet/wallet.service';
import { TransactionType } from '../models/Transaction';
import { logger } from '../lib/logger';
import { mongoose } from '../lib/db';

const AUDIO_RATE = parseInt(process.env.AUDIO_CALL_COINS_PER_MINUTE || '10', 10);
const VIDEO_RATE = parseInt(process.env.VIDEO_CALL_COINS_PER_MINUTE || '60', 10);
const TICK_INTERVAL_SECONDS = 30;
const RESPONDER_COMMISSION = parseInt(
  process.env.RESPONDER_COMMISSION_PERCENTAGE || '70',
  10
);

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

let callMeteringQueue: Queue | undefined;
let callMeteringWorker: Worker | undefined;

if (REDIS_ENABLED && redis) {
  callMeteringQueue = new Queue('call-metering', {
    connection: redis as any,
  });

  callMeteringWorker = new Worker(
    'call-metering',
    async (job) => {
      const { callId } = job.data;

      try {
        const call = await Call.findById(callId);

        if (!call || call.status !== CallStatus.ACTIVE) {
          // Call ended or not active, remove repeatable job
          if (callMeteringQueue) {
            await callMeteringQueue.removeRepeatableByKey(job.repeatJobKey!);
          }
          return { status: 'stopped', reason: 'call_not_active' };
        }

        const user = await User.findById(call.userId);
        if (!user) {
          throw new Error('User not found');
        }

        // Calculate coins to deduct for this tick
        const rate = call.type === CallType.AUDIO ? AUDIO_RATE : VIDEO_RATE;
        const coinsPerSecond = rate / 60;
        const coinsForTick = Math.ceil(coinsPerSecond * TICK_INTERVAL_SECONDS);

        // Check if user has sufficient balance
        if (user.coinBalance < coinsForTick) {
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

          // TODO: Emit socket event to notify clients

          return { status: 'ended', reason: 'insufficient_balance' };
        }

        // Deduct coins and split commission
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
          // Deduct from user
          await User.findByIdAndUpdate(
            user._id,
            { $inc: { coinBalance: -coinsForTick } },
            { session }
          );

          // Calculate commission
          const responderCoins = Math.floor((coinsForTick * RESPONDER_COMMISSION) / 100);

          // Credit responder
          await Responder.findByIdAndUpdate(
            call.responderId,
            { $inc: { 'earnings.pendingCoins': responderCoins } },
            { session }
          );

          // Update call
          await Call.findByIdAndUpdate(
            callId,
            {
              $inc: { coinsCharged: coinsForTick },
              $set: {
                'liveMeter.lastTick': new Date(),
                'liveMeter.remainingBalance': user.coinBalance - coinsForTick,
              },
            },
            { session }
          );

          await session.commitTransaction();

          logger.info(
            `Call ${callId}: Charged ${coinsForTick} coins, remaining: ${
              user.coinBalance - coinsForTick
            }`
          );

          // TODO: Emit socket event with updated balance

          return {
            status: 'metered',
            coinsCharged: coinsForTick,
            remainingBalance: user.coinBalance - coinsForTick,
          };
        } catch (error) {
          await session.abortTransaction();
          throw error;
        } finally {
          session.endSession();
        }
      } catch (error) {
        logger.error(`Call metering error for ${callId}:`, error);
        throw error;
      }
    },
    {
      connection: redis as any,
      concurrency: 10,
    }
  );

  callMeteringWorker.on('completed', (job) => {
    logger.debug(`Job ${job.id} completed:`, job.returnvalue);
  });

  callMeteringWorker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed:`, err);
  });
} else {
  logger.warn('Call metering jobs are disabled (Redis not enabled).');
}

export { callMeteringQueue, callMeteringWorker };
