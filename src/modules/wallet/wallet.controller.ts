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

    // Count purchases per plan for this user
    const userId = req.user?.id;
    const purchaseCountMap: Map<string, number> = new Map();
    if (userId) {
      const previousPayments = await Payment.find({
        userId: new Types.ObjectId(userId),
        status: PaymentStatus.SUCCESS,
      }).select('planId').lean();
      for (const p of previousPayments) {
        const pid = p.planId.toString();
        purchaseCountMap.set(pid, (purchaseCountMap.get(pid) || 0) + 1);
      }
    }

    // Transform plans with purchase count, lock status, and discount
    // Plans are sorted by priceINR ascending; the last plan is unlimited
    const transformedPlans = plans.map((plan, index) => {
      const planId = plan._id.toString();
      const purchaseCount = purchaseCountMap.get(planId) || 0;
      const isLastPlan = index === plans.length - 1;
      const planMaxUses = plan.maxUses || null; // Admin-configured limit per plan

      // Last plan is never locked; other plans lock after their maxUses
      const isLocked = !isLastPlan && planMaxUses != null && purchaseCount >= planMaxUses;

      // Discount only on 1st purchase of this plan
      const effectiveDiscount = purchaseCount > 0
        ? 0
        : (plan.discount || 0);

      return {
        _id: plan._id,
        name: plan.name,
        priceINR: plan.priceINR,
        coins: plan.coins,
        discount: effectiveDiscount,
        tags: plan.tags,
        isActive: plan.isActive,
        maxUses: plan.maxUses,
        purchaseCount,
        isLocked,
        maxPurchases: isLastPlan ? null : planMaxUses,
      };
    });

    logger.info({
      plansCount: plans.length,
      userId,
      purchaseCounts: Object.fromEntries(purchaseCountMap),
    }, 'Coin plans returned with per-plan limits');

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
