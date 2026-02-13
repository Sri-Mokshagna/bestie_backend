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

            // Find responders who need to be disabled
            // FIXED: Removed isOnline: false to catch responders stuck in isOnline: true state
            const inactiveResponders = await Responder.find({
                $and: [
                    {
                        // Find responders with old or missing lastOnlineAt
                        $or: [
                            { lastOnlineAt: { $lt: twoHoursAgo } },
                            { lastOnlineAt: { $exists: false } },
                            { lastOnlineAt: null },
                        ],
                    },
                    {
                        // At least one toggle must be enabled (otherwise nothing to disable)
                        $or: [
                            { audioEnabled: true },
                            { videoEnabled: true },
                            { chatEnabled: true },
                        ],
                    },
                ],
            }).select('userId').lean();

            if (inactiveResponders.length === 0) {
                return; // No responders to disable
            }

            const userIds = inactiveResponders.map(r => r.userId);

            // Update Responder model: disable all toggles and set offline
            const responderResult = await Responder.updateMany(
                {
                    $and: [
                        {
                            $or: [
                                { lastOnlineAt: { $lt: twoHoursAgo } },
                                { lastOnlineAt: { $exists: false } },
                                { lastOnlineAt: null },
                            ],
                        },
                        {
                            $or: [
                                { audioEnabled: true },
                                { videoEnabled: true },
                                { chatEnabled: true },
                            ],
                        },
                    ],
                },
                {
                    $set: {
                        isOnline: false,      // Set offline in Responder model
                        audioEnabled: false,
                        videoEnabled: false,
                        chatEnabled: false,
                    },
                }
            );

            // CRITICAL: Also update User model so users don't see them as "online"
            // AND update toggle fields since call service checks User.audioEnabled etc.
            const userResult = await import('../models/User').then(({ User }) =>
                User.updateMany(
                    { _id: { $in: userIds } },
                    {
                        $set: {
                            isOnline: false,
                            audioEnabled: false,  // CRITICAL: Call service checks these!
                            videoEnabled: false,
                            chatEnabled: false,
                        }
                    }
                )
            );

            if (responderResult.modifiedCount > 0) {
                logger.info(
                    {
                        count: responderResult.modifiedCount,
                        usersUpdated: userResult.modifiedCount,
                        threshold: '2 hours',
                        action: 'auto_disabled_toggles',
                    },
                    `🔴 Auto-disabled ${responderResult.modifiedCount} inactive responder(s) and set ${userResult.modifiedCount} user(s) offline`
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
