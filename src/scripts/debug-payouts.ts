import 'dotenv/config';
import { connectDB } from '../lib/db';
import { Payout } from '../models/Payout';
import { Responder } from '../models/Responder';
import { logger } from '../lib/logger';

/**
 * Debug script to check existing payouts and their status
 */

async function checkPayouts() {
    logger.info('🔍 Checking existing payouts in database...');

    try {
        await connectDB();

        // Get all payouts with their details
        const payouts = await Payout.find()
            .populate({
                path: 'responderId',
                select: 'userId earnings upiId',
                populate: {
                    path: 'userId',
                    select: 'profile phone email',
                },
            })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        logger.info(`📊 Found ${payouts.length} recent payouts`);

        if (payouts.length === 0) {
            logger.warn('⚠️ No payouts found in database');
            return;
        }

        // Analyze each payout
        payouts.forEach((payout: any, index) => {
            const responder = payout.responderId;
            const user = responder?.userId;

            logger.info({
                index: index + 1,
                payoutId: payout._id,
                status: payout.status,
                coins: payout.coins,
                amountINR: payout.amountINR,
                upiId: payout.upiId,
                responderName: user?.profile?.name || 'Unknown',
                responderPhone: user?.phone,
                createdAt: payout.createdAt,
                completedAt: payout.completedAt,
                gatewayResponse: payout.gatewayResponse,
                rejectionReason: payout.rejectionReason,
            }, `Payout #${index + 1}`);

            // Specific issue detection
            if (payout.status === 'pending') {
                logger.warn(`⚠️ Payout #${index + 1} is still PENDING - needs admin approval`);
            } else if (payout.status === 'processing') {
                logger.warn(`⚠️ Payout #${index + 1} is PROCESSING - may be stuck`);
            } else if (payout.status === 'failed') {
                logger.error(`❌ Payout #${index + 1} FAILED - Error: ${JSON.stringify(payout.gatewayResponse)}`);
            } else if (payout.status === 'completed') {
                if (payout.gatewayResponse) {
                    logger.info(`✅ Payout #${index + 1} completed with gateway response: ${JSON.stringify(payout.gatewayResponse)}`);
                } else {
                    logger.warn(`⚠️ Payout #${index + 1} marked as completed but no gateway response`);
                }
            }
        });

        // Summary
        const statusCounts = payouts.reduce((acc: any, p: any) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
        }, {});

        logger.info({
            statusCounts,
            totalPayouts: payouts.length,
        }, '📊 Payout Status Summary');

        // Check for specific issues
        const pendingCount = statusCounts.pending || 0;
        const processingCount = statusCounts.processing || 0;
        const failedCount = statusCounts.failed || 0;
        const completedCount = statusCounts.completed || 0;

        if (pendingCount > 0) {
            logger.warn(`⚠️ ${pendingCount} payout(s) awaiting admin approval`);
        }

        if (processingCount > 0) {
            logger.error(`❌ ${processingCount} payout(s) stuck in PROCESSING state - likely Cashfree API issue`);
        }

        if (failedCount > 0) {
            logger.error(`❌ ${failedCount} payout(s) failed - check gateway responses above`);
        }

        if (completedCount > 0 && completedCount === payouts.length) {
            logger.info(`✅ All recent payouts are completed`);
        }

    } catch (error: any) {
        logger.error({ error: error.message }, '❌ Failed to check payouts');
    } finally {
        process.exit(0);
    }
}

async function checkBeneficiaries() {
    logger.info('👥 Checking responder beneficiary information...');

    try {
        const responders = await Responder.find({ upiId: { $exists: true, $ne: null } })
            .populate('userId', 'profile phone email')
            .limit(10)
            .lean();

        logger.info(`📊 Found ${responders.length} responders with UPI IDs`);

        responders.forEach((resp: any, index) => {
            logger.info({
                index: index + 1,
                responderId: resp._id,
                responderName: resp.userId?.profile?.name || 'Unknown',
                upiId: resp.upiId,
                pendingCoins: resp.earnings?.pendingCoins,
                redeemedCoins: resp.earnings?.redeemedCoins,
                totalCoins: resp.earnings?.totalCoins,
            }, `Responder #${index + 1}`);
        });

    } catch (error: any) {
        logger.error({ error: error.message }, '❌ Failed to check beneficiaries');
    }
}

async function main() {
    logger.info('🚀 Starting Payout Debug Script...\n');

    await checkPayouts();
    logger.info('\n');
    await checkBeneficiaries();

    process.exit(0);
}

if (require.main === module) {
    main().catch((error) => {
        logger.error({ error }, '❌ Debug script failed');
        process.exit(1);
    });
}
