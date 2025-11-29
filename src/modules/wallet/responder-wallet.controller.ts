import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { Responder } from '../../models/Responder';
import { Transaction, TransactionType } from '../../models/Transaction';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';

/**
 * Responder Wallet Controller
 * Handles responder earnings and transaction history
 */

export const getResponderBalance = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        throw new AppError(401, 'Not authenticated');
    }

    let responder = await Responder.findOne({ userId: req.user.id });

    // Create responder record if doesn't exist
    if (!responder) {
        responder = await Responder.create({
            userId: req.user.id,
            earnings: {
                totalCoins: 0,
                pendingCoins: 0,
                lockedCoins: 0,
                redeemedCoins: 0,
            },
        });
    }

    res.json({
        totalEarnings: responder.earnings.totalCoins,
        availableForRedemption: responder.earnings.pendingCoins,
        locked: responder.earnings.lockedCoins,
        redeemed: responder.earnings.redeemedCoins,
    });
});

export const getResponderTransactions = asyncHandler(async (req: AuthRequest, res: Response) => {
    if (!req.user) {
        throw new AppError(401, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    // Get transactions where this user was the responder
    const transactions = await Transaction.find({
        responderId: req.user.id,
        type: { $in: [TransactionType.CALL, TransactionType.CHAT] },
    })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'phone profile')
        .lean();

    const total = await Transaction.countDocuments({
        responderId: req.user.id,
        type: { $in: [TransactionType.CALL, TransactionType.CHAT] },
    });

    res.json({
        transactions: transactions.map((t: any) => ({
            id: t._id,
            type: t.type,
            coins: t.coins,
            status: t.status,
            meta: t.meta,
            user: t.userId,
            createdAt: t.createdAt,
        })),
        pagination: {
            page,
            limit,
            total,
            pages: Math.ceil(total / limit),
        },
    });
});
