import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { Responder } from '../../models/Responder';
import { Payout, PayoutStatus } from '../../models/Payout';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../lib/asyncHandler';
import { mongoose } from '../../lib/db';
import { cashfreeService } from '../../lib/cashfree';

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
    upiId: responder.upiId,
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
      upiId: p.upiId,
      status: p.status,
      rejectionReason: p.rejectionReason,
      rejectedAt: p.rejectedAt,
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

  const { upiId, amount } = req.body;

  if (!upiId || !amount) {
    throw new AppError(400, 'UPI ID and amount are required');
  }

  // Validate UPI ID format
  const upiRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+$/;
  if (!upiRegex.test(upiId)) {
    throw new AppError(400, 'Invalid UPI ID format');
  }

  const responder = await Responder.findOne({ userId: req.user.id });
  if (!responder) {
    throw new AppError(404, 'Responder profile not found');
  }

  // Check if responder has minimum required coins
  const redemptionInfo = await coinService.canRedeem(req.user.id);
  if (!redemptionInfo.canRedeem) {
    throw new AppError(
      400,
      `Minimum ${redemptionInfo.minRequired} coins required for redemption. You have ${redemptionInfo.pendingCoins} coins.`,
      'INSUFFICIENT_COINS'
    );
  }

  // Validate amount
  const coinsToRedeem = parseInt(amount);
  if (isNaN(coinsToRedeem) || coinsToRedeem < 1) {
    throw new AppError(400, 'Amount must be at least 1 coin');
  }

  if (coinsToRedeem > responder.earnings.pendingCoins) {
    throw new AppError(
      400,
      `Amount must be less than or equal to your available balance (${responder.earnings.pendingCoins} coins)`,
      'AMOUNT_EXCEEDS_BALANCE'
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

  const amountINR = await coinService.calculateRedemptionAmount(coinsToRedeem);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Save UPI ID to responder profile for future use
    if (responder.upiId !== upiId) {
      await Responder.findByIdAndUpdate(
        responder._id,
        { upiId: upiId.trim() },
        { session }
      );
    }

    // Create payout request
    const payout = await Payout.create(
      [
        {
          responderId: responder._id,
          coins: coinsToRedeem,
          amountINR,
          upiId: upiId.trim(),
          status: PayoutStatus.PENDING,
        },
      ],
      { session }
    );

    // Move coins from pending to redeemed (will be reverted if payout is rejected)
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
        upiId: payout[0].upiId,
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
  const { status, rejectionReason } = req.body;

  if (!['completed', 'rejected'].includes(status)) {
    throw new AppError(400, 'Invalid status. Must be completed or rejected');
  }

  const payout = await Payout.findById(payoutId).populate({
    path: 'responderId',
    select: 'userId',
    populate: {
      path: 'userId',
      select: 'profile phone email',
    },
  });

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
      // Update status to processing
      payout.status = PayoutStatus.PROCESSING;
      await payout.save({ session });

      // Get responder details
      const responder: any = payout.responderId;
      const user: any = responder.userId;

      // Create beneficiary ID (unique per responder)
      const beneId = `BENE_${responder._id}`;
      const transferId = `TRANSFER_${payout._id}`;

      try {
        // Step 1: Create/Register beneficiary with Cashfree
        await cashfreeService.createBeneficiary({
          beneId,
          name: user.profile?.name || 'Responder',
          email: user.email || `responder${responder._id}@bestie.app`,
          phone: user.phone,
          vpa: payout.upiId,
        });

        // Step 2: Request payout transfer
        const payoutResponse = await cashfreeService.requestPayout({
          transferId,
          beneId,
          amount: payout.amountINR,
          transferMode: 'upi',
          remarks: `Payout for ${payout.coins} coins`,
        });

        // Step 3: Update payout with gateway response
        payout.status = PayoutStatus.COMPLETED;
        payout.completedAt = new Date();
        payout.gatewayResponse = payoutResponse;
        await payout.save({ session });

        await session.commitTransaction();

        res.json({
          message: 'Payout processed successfully',
          payout: {
            id: payout._id,
            coins: payout.coins,
            amountINR: payout.amountINR,
            upiId: payout.upiId,
            status: payout.status,
            completedAt: payout.completedAt,
          },
        });
        return;
      } catch (cashfreeError: any) {
        // If Cashfree API fails, mark payout as failed and revert coins
        payout.status = PayoutStatus.FAILED;
        payout.gatewayResponse = {
          error: cashfreeError.response?.data || cashfreeError.message,
        };
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

        await session.commitTransaction();
        session.endSession();

        throw new AppError(
          500,
          `Payout failed: ${cashfreeError.response?.data?.message || cashfreeError.message}`
        );
      }
    } else if (status === 'rejected') {
      // Payout rejected, revert coins
      payout.status = PayoutStatus.REJECTED;
      payout.rejectedAt = new Date();
      payout.rejectionReason = rejectionReason || 'Rejected by admin';
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

      await session.commitTransaction();

      res.json({
        message: 'Payout rejected successfully',
        payout: {
          id: payout._id,
          coins: payout.coins,
          amountINR: payout.amountINR,
          upiId: payout.upiId,
          status: payout.status,
          rejectionReason: payout.rejectionReason,
          rejectedAt: payout.rejectedAt,
        },
      });
      return;
    }


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
    .populate({
      path: 'responderId',
      select: 'userId earnings',
      populate: {
        path: 'userId',
        select: 'profile phone',
      },
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Payout.countDocuments(query);

  res.json({
    payouts: payouts.map((p: any) => ({
      id: p._id,
      responderId: p.responderId._id,
      responderUserId: p.responderId.userId?._id,
      responderName: p.responderId.userId?.profile?.name || 'Unknown',
      responderPhone: p.responderId.userId?.phone,
      coins: p.coins,
      amountINR: p.amountINR,
      upiId: p.upiId,
      status: p.status,
      rejectionReason: p.rejectionReason,
      rejectedAt: p.rejectedAt,
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
