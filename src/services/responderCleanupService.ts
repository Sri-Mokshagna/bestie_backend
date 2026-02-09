import cron from 'node-cron';
import { Responder } from '../models/Responder';
import { logger } from '../lib/logger';

/**
 * Service to automatically disable responder toggles (audio, video, chat)
 * after they've been offline for 2+ hours.
 * 
 * Runs every 15 minutes via cron job.
 */
class ResponderCleanupService {
    /**
     * Disable audio/video/chat toggles for responders who have been offline for 2+ hours
     */
    async disableInactiveResponders(): Promise<void> {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

            // Find responders who:
            // 1. Are currently offline (isOnline = false)
            // 2. Haven't been online for 2+ hours (lastOnlineAt < 2 hours ago)
            // 3. Have at least one toggle enabled
            const result = await Responder.updateMany(
                {
                    isOnline: false,
                    lastOnlineAt: { $lt: twoHoursAgo },
                    $or: [
                        { audioEnabled: true },
                        { videoEnabled: true },
                        { chatEnabled: true },
                    ],
                },
                {
                    $set: {
                        audioEnabled: false,
                        videoEnabled: false,
                        chatEnabled: false,
                    },
                }
            );

            if (result.modifiedCount > 0) {
                logger.info(
                    {
                        count: result.modifiedCount,
                        threshold: '2 hours',
                        action: 'auto_disabled_toggles',
                    },
                    `🔴 Auto-disabled toggles for ${result.modifiedCount} inactive responder(s)`
                );
            }
        } catch (error) {
            logger.error(
                {
                    error,
                    service: 'ResponderCleanupService',
                },
                '❌ Failed to disable inactive responders'
            );
        }
    }

    /**
     * Start the cron job to run cleanup every 15 minutes
     */
    start(): void {
        // Run every 15 minutes: */15 * * * *
        // Format: minute hour day month dayOfWeek
        cron.schedule('*/15 * * * *', async () => {
            logger.debug('🔄 Running responder cleanup job...');
            await this.disableInactiveResponders();
        });

        logger.info('✅ Responder cleanup service started (runs every 15 minutes)');

        // Run immediately on startup
        this.disableInactiveResponders();
    }
}

export const responderCleanupService = new ResponderCleanupService();
