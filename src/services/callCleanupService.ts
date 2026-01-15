import { logger } from '../lib/logger';
import { Call, CallStatus } from '../models/Call';
import { User } from '../models/User';
import { Responder } from '../models/Responder';

/**
 * ADDITIVE SAFETY SERVICE - Cleanup stuck inCall flags
 * This service adds protective cleanup without affecting existing call flow
 * Runs in background every 2 minutes to fix edge cases
 */

export class CallCleanupService {
    private static cleanupInterval: NodeJS.Timeout | null = null;
    private static isRunning = false;

    /**
     * Start the cleanup service (safe to call multiple times)
     */
    static start() {
        if (this.cleanupInterval) {
            logger.info('CallCleanupService already running');
            return;
        }

        logger.info('🧹 Starting CallCleanupService - Background safety task');

        // Run immediately on start
        this.runCleanup().catch(err => {
            logger.error({ error: err.message }, 'Initial cleanup failed (non-critical)');
        });

        // Then run every 2 minutes
        this.cleanupInterval = setInterval(() => {
            this.runCleanup().catch(err => {
                logger.error({ error: err.message }, 'Scheduled cleanup failed (non-critical)');
            });
        }, 2 * 60 * 1000); // 2 minutes

        logger.info('✅ CallCleanupService started (runs every 2 minutes)');
    }

    /**
     * Stop the cleanup service (for graceful shutdown)
     */
    static stop() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            logger.info('🛑 CallCleanupService stopped');
        }
    }

    /**
     * Run cleanup - safe to run anytime, won't affect active calls
     */
    private static async runCleanup() {
        if (this.isRunning) {
            logger.debug('Cleanup already in progress, skipping');
            return;
        }

        this.isRunning = true;

        try {
            const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
            let fixedCount = 0;

            // Find responders who have inCall=true but NO active calls
            const respondersWithInCallFlag = await User.find({
                role: 'responder',
                inCall: true,
            }).select('_id').lean();

            if (respondersWithInCallFlag.length === 0) {
                logger.debug('No responders with inCall flag, cleanup not needed');
                this.isRunning = false;
                return;
            }

            for (const responder of respondersWithInCallFlag) {
                // Check if they actually have an active call
                const activeCall = await Call.findOne({
                    responderId: responder._id,
                    status: { $in: [CallStatus.RINGING, CallStatus.CONNECTING, CallStatus.ACTIVE] },
                    createdAt: { $gt: twoMinutesAgo }, // Only recent calls
                });

                if (!activeCall) {
                    // No active call but flag is stuck - SAFE TO FIX
                    await User.findByIdAndUpdate(responder._id, { inCall: false });
                    await Responder.findOneAndUpdate({ userId: responder._id }, { inCall: false });
                    fixedCount++;

                    logger.info({
                        responderId: responder._id.toString(),
                    }, '🔧 Fixed stuck inCall flag (no active call found)');
                }
            }

            if (fixedCount > 0) {
                logger.info({
                    fixedCount,
                    totalChecked: respondersWithInCallFlag.length,
                }, '✅ Cleanup completed - Fixed stuck flags');
            } else {
                logger.debug({
                    totalChecked: respondersWithInCallFlag.length,
                }, 'Cleanup completed - All flags valid');
            }

        } catch (error: any) {
            logger.error({
                error: error.message,
                stack: error.stack,
            }, '❌ Cleanup task failed (non-critical, will retry)');
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Manual cleanup trigger (for admin/debugging)
     */
    static async manualCleanup() {
        logger.info('🔧 Manual cleanup triggered');
        await this.runCleanup();
    }
}
