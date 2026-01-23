import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { Responder } from '../../models/Responder';
import { Payout, PayoutStatus } from '../../models/Payout';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';
import { mongoose } from '../../lib/db';
import { cashfreeService } from '../../lib/cashfree';
import { logger } from '../../lib/logger';

/**
 * Admin endpoint to check Cashfree payout balance
 * Helps diagnose if insufficient funds are causing payout failures
 */
export const getPayoutBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
        logger.info('🔍 Admin checking payout balance');

        const balance = await cashfreeService.getPayoutBalance();

        logger.info({
            balance: balance.data?.balance,
            status: balance.status,
        }, '✅ Payout balance retrieved');

        res.json({
            balance: balance.data?.balance || 0,
            currency: 'INR',
            status: balance.status,
            lastChecked: new Date().toISOString(),
            message: balance.data?.balance
                ? `Available balance: ₹${balance.data.balance}`
                : 'Balance information not available',
        });
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
        }, '❌ Failed to get payout balance');

        // Provide helpful error messages
        if (error.response?.status === 401) {
            throw new AppError(500, 'Payout API authentication failed. Please check CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET');
        } else if (error.message?.includes('not configured')) {
            throw new AppError(500, 'Payout credentials not configured. Please set CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET in environment variables');
        }

        throw new AppError(500, `Failed to get payout balance: ${error.message}`);
    }
});
