import { Response } from 'express';
import { Types } from 'mongoose';
import { AuthRequest } from '../../middleware/auth';
import { walletService } from './wallet.service';
import { PaymentService } from '../../services/paymentService';
import { Payment, PaymentStatus } from '../../models/Payment';
import { coinService } from '../../services/coinService';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../lib/logger';

const paymentService = new PaymentService();

export const walletController = {
  async getBalance(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const balance = await walletService.getBalance(req.user.id);
    res.json({ balance });
  },

  async getTransactions(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    const result = await walletService.getTransactions(req.user.id, page, limit);
    res.json(result);
  },

  async getCoinPlans(req: AuthRequest, res: Response) {
    const plans = await walletService.getCoinPlans();

    // Get coin config to calculate actual coins based on coinsToINRRate
    const config = await coinService.getConfig();

    // Check if user has any previous successful payments
    // This determines if first-time discounts should be shown
    const userId = req.user?.id;
    let hasExistingPayments = false;
    if (userId) {
      const previousSuccessfulPayments = await Payment.countDocuments({
        userId: new Types.ObjectId(userId),
        status: PaymentStatus.SUCCESS,
      });
      hasExistingPayments = previousSuccessfulPayments > 0;
    }

    // Transform plans: strip first-time discount for returning users
    const transformedPlans = plans.map(plan => {
      const calculatedCoins = Math.floor(plan.priceINR / config.coinsToINRRate);
      const isFirstTimePlan = plan.tags.includes('first-time' as any);
      const effectiveDiscount = (isFirstTimePlan && hasExistingPayments)
        ? 0
        : (plan.discount || 0);

      return {
        _id: plan._id,
        name: plan.name,
        priceINR: plan.priceINR,
        coins: calculatedCoins,
        discount: effectiveDiscount,
        tags: plan.tags,
        isActive: plan.isActive,
        maxUses: plan.maxUses,
      };
    });

    logger.info({
      plansCount: plans.length,
      hasExistingPayments,
      userId,
    }, 'Coin plans returned with discount check');

    res.json({ plans: transformedPlans });
  },

  async verifyPurchase(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { productId, purchaseToken, platform } = req.body;

    if (!productId || !purchaseToken || !platform) {
      throw new AppError(400, 'Missing required fields');
    }

    if (!['android', 'ios'].includes(platform)) {
      throw new AppError(400, 'Invalid platform');
    }

    const result = await walletService.verifyIAPPurchase(
      req.user.id,
      productId,
      purchaseToken,
      platform as 'android' | 'ios'
    );

    res.json(result);
  },

  async verifyAdReward(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { rewardType, rewardAmount, adUnitId } = req.body;

    if (!rewardType || !rewardAmount || !adUnitId) {
      throw new AppError(400, 'Missing required fields');
    }

    const result = await walletService.verifyAdReward(
      req.user.id,
      rewardType,
      rewardAmount,
      adUnitId
    );

    res.json(result);
  },

  async createPaymentOrder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { planId } = req.body;

    if (!planId) {
      throw new AppError(400, 'Plan ID is required');
    }

    const result = await paymentService.createPaymentOrder(req.user.id, planId);

    // Generate payment initiate URL for SDK checkout
    const serverUrl = process.env.SERVER_URL || 'https://bestie-backend-prod.onrender.com';
    const paymentInitiateUrl = `${serverUrl}/pay/initiate?orderId=${result.orderId}`;

    logger.info({
      orderId: result.orderId,
      paymentInitiateUrl
    }, 'Payment order created - SDK checkout ready');

    res.json({
      orderId: result.orderId,
      // App should open this URL in browser for SDK checkout
      payment_link: paymentInitiateUrl,
      amount: result.amount,
      coins: result.coins,
      planName: result.planName,
      // Also provide session ID if app wants to use native SDK
      paymentSessionId: result.paymentSessionId,
    });
  },

  async verifyPaymentAndCredit(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { orderId } = req.body;

    if (!orderId) {
      throw new AppError(400, 'Order ID is required');
    }

    const payment = await paymentService.getPaymentStatus(orderId, req.user.id);

    res.json({
      status: payment.status,
      orderId: payment.orderId,
      amount: payment.amount,
      coins: payment.coins,
    });
  },
};
