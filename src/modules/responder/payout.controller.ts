import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { Responder } from '../../models/Responder';
import { Payout, PayoutStatus } from '../../models/Payout';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';
import { mongoose } from '../../lib/db';

/**
 * Responder Payout/Redemption Controller
 */

export const getEarnings = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const responder = await Responder.findOne({ userId: req.user.id });
  if (!responder) {
    throw new AppError(404, 'Responder profile not found');
  }

  const redemptionInfo = await coinService.canRedeem(req.user.id);
  const redemptionAmount = await coinService.calculateRedemptionAmount(
    responder.earnings.pendingCoins
  );

  res.json({
    earnings: {
      totalCoins: responder.earnings.totalCoins,
      pendingCoins: responder.earnings.pendingCoins,
      redeemedCoins: responder.earnings.redeemedCoins,
    },
    redemption: {
      canRedeem: redemptionInfo.canRedeem,
      minRequired: redemptionInfo.minRequired,
      amountINR: redemptionAmount,
    },
  });
});

export const getPayoutHistory = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const responder = await Responder.findOne({ userId: req.user.id });
  if (!responder) {
    throw new AppError(404, 'Responder profile not found');
  }

  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const payouts = await Payout.find({ responderId: responder._id })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Payout.countDocuments({ responderId: responder._id });

  res.json({
    payouts: payouts.map((p) => ({
      id: p._id,
      coins: p.coins,
      amountINR: p.amountINR,
      status: p.status,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});

export const requestPayout = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError(401, 'Not authenticated');
  }

  const responder = await Responder.findOne({ userId: req.user.id });
  if (!responder) {
    throw new AppError(404, 'Responder profile not found');
  }

  // Check if responder can redeem
  const redemptionInfo = await coinService.canRedeem(req.user.id);
  if (!redemptionInfo.canRedeem) {
    throw new AppError(
      400,
      `Minimum ${redemptionInfo.minRequired} coins required for redemption. You have ${redemptionInfo.pendingCoins} coins.`,
      'INSUFFICIENT_COINS'
    );
  }

  // Check if there's already a pending payout
  const existingPayout = await Payout.findOne({
    responderId: responder._id,
    status: { $in: [PayoutStatus.PENDING, PayoutStatus.PROCESSING] },
  });

  if (existingPayout) {
    throw new AppError(400, 'You already have a pending payout request', 'PAYOUT_PENDING');
  }

  // Check if bank details are set
  if (!responder.bankDetails) {
    throw new AppError(400, 'Please add bank details before requesting payout', 'BANK_DETAILS_MISSING');
  }

  const coinsToRedeem = responder.earnings.pendingCoins;
  const amountINR = await coinService.calculateRedemptionAmount(coinsToRedeem);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Create payout request
    const payout = await Payout.create(
      [
        {
          responderId: responder._id,
          coins: coinsToRedeem,
          amountINR,
          status: PayoutStatus.PENDING,
        },
      ],
      { session }
    );

    // Move coins from pending to redeemed (will be reverted if payout fails)
    await Responder.findByIdAndUpdate(
      responder._id,
      {
        $inc: {
          'earnings.pendingCoins': -coinsToRedeem,
          'earnings.redeemedCoins': coinsToRedeem,
        },
      },
      { session }
    );

    await session.commitTransaction();

    res.json({
      message: 'Payout request submitted successfully',
      payout: {
        id: payout[0]._id,
        coins: payout[0].coins,
        amountINR: payout[0].amountINR,
        status: payout[0].status,
        createdAt: payout[0].createdAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * Admin endpoint to process payout
 * This would integrate with payment gateway
 */
export const processPayout = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { payoutId } = req.params;
  const { status, gatewayResponse } = req.body;

  if (!['completed', 'failed'].includes(status)) {
    throw new AppError(400, 'Invalid status. Must be completed or failed');
  }

  const payout = await Payout.findById(payoutId);
  if (!payout) {
    throw new AppError(404, 'Payout not found');
  }

  if (payout.status !== PayoutStatus.PENDING && payout.status !== PayoutStatus.PROCESSING) {
    throw new AppError(400, 'Payout is not in pending or processing state');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (status === 'completed') {
      // Mark payout as completed
      payout.status = PayoutStatus.COMPLETED;
      payout.completedAt = new Date();
      payout.gatewayResponse = gatewayResponse;
      await payout.save({ session });
    } else {
      // Payout failed, revert coins
      payout.status = PayoutStatus.FAILED;
      payout.gatewayResponse = gatewayResponse;
      await payout.save({ session });

      // Move coins back to pending
      await Responder.findByIdAndUpdate(
        payout.responderId,
        {
          $inc: {
            'earnings.pendingCoins': payout.coins,
            'earnings.redeemedCoins': -payout.coins,
          },
        },
        { session }
      );
    }

    await session.commitTransaction();

    res.json({
      message: `Payout ${status} successfully`,
      payout: {
        id: payout._id,
        coins: payout.coins,
        amountINR: payout.amountINR,
        status: payout.status,
        completedAt: payout.completedAt,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * Admin endpoint to get all payout requests
 */
export const getAllPayouts = asyncHandler(async (req: AuthRequest, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const status = req.query.status as string;
  const skip = (page - 1) * limit;

  const query: any = {};
  if (status) {
    query.status = status;
  }

  const payouts = await Payout.find(query)
    .populate('responderId', 'userId earnings')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Payout.countDocuments(query);

  res.json({
    payouts: payouts.map((p: any) => ({
      id: p._id,
      responderId: p.responderId._id,
      responderUserId: p.responderId.userId,
      coins: p.coins,
      amountINR: p.amountINR,
      status: p.status,
      createdAt: p.createdAt,
      completedAt: p.completedAt,
    })),
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  });
});
