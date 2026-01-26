/**
 * Migration Script: Convert Responder Earnings from Coins to Rupees
 * 
 * This script converts existing responder earnings from coins to rupees
 * by applying the current coin-to-INR conversion rate.
 * 
 * Run this ONCE after deploying the new code with rupees schema.
 */

import { Responder } from '../models/Responder';
import { commissionService } from '../services/commissionService';
import { logger } from '../lib/logger';

export async function migrateResponderEarningsToRupees() {
    try {
        logger.info('Starting migration: Converting responder earnings from coins to rupees');

        // Get the current coin-to-INR rate
        const coinToINRRate = await commissionService.getCoinToINRRate();
        logger.info({ coinToINRRate }, 'Using coin-to-INR rate for conversion');

        // Find all responders with old coin-based earnings
        const responders = await Responder.find({
            $or: [
                { 'earnings.totalCoins': { $exists: true } },
                { 'earnings.pendingCoins': { $exists: true } },
                { 'earnings.lockedCoins': { $exists: true } },
                { 'earnings.redeemedCoins': { $exists: true } },
            ]
        });

        logger.info({ totalResponders: responders.length }, 'Found responders to migrate');

        let migratedCount = 0;
        let skippedCount = 0;

        for (const responder of responders) {
            try {
                const oldEarnings = responder.earnings as any;

                // Convert coins to rupees
                const totalRupees = Math.round((oldEarnings.totalCoins || 0) * coinToINRRate);
                const pendingRupees = Math.round((oldEarnings.pendingCoins || 0) * coinToINRRate);
                const lockedRupees = Math.round((oldEarnings.lockedCoins || 0) * coinToINRRate);
                const redeemedRupees = Math.round((oldEarnings.redeemedCoins || 0) * coinToINRRate);

                // Update to new rupee-based schema
                responder.earnings = {
                    totalRupees,
                    pendingRupees,
                    lockedRupees,
                    redeemedRupees,
                } as any;

                await responder.save();

                migratedCount++;
                logger.info({
                    responderId: responder._id,
                    userId: responder.userId,
                    old: {
                        totalCoins: oldEarnings.totalCoins,
                        pendingCoins: oldEarnings.pendingCoins,
                        lockedCoins: oldEarnings.lockedCoins,
                        redeemedCoins: oldEarnings.redeemedCoins,
                    },
                    new: {
                        totalRupees,
                        pendingRupees,
                        lockedRupees,
                        redeemedRupees,
                    },
                }, 'Migrated responder earnings');

            } catch (error) {
                skippedCount++;
                logger.error({
                    responderId: responder._id,
                    error: error instanceof Error ? error.message : String(error),
                }, 'Failed to migrate responder');
            }
        }

        logger.info({
            totalFound: responders.length,
            migrated: migratedCount,
            skipped: skippedCount,
            coinToINRRate,
        }, 'Migration completed successfully');

        return {
            success: true,
            totalFound: responders.length,
            migrated: migratedCount,
            skipped: skippedCount,
        };

    } catch (error) {
        logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Migration failed');
        throw error;
    }
}

// If running directly
if (require.main === module) {
    migrateResponderEarningsToRupees()
        .then((result) => {
            console.log('Migration result:', result);
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration error:', error);
            process.exit(1);
        });
}
