import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { walletService } from './wallet.service';
import { coinService } from '../../services/coinService';
import { paymentGateway } from '../../services/paymentGateway';
import { AppError } from '../../middleware/errorHandler';
import { TransactionType } from '../../models/Transaction';

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

    res.json({ plans });
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

  /**
   * Create payment order for coin purchase
   */
  async createPaymentOrder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { planId } = req.body;

    if (!planId) {
      throw new AppError(400, 'Plan ID is required');
    }

    // Get coin plan
    const plans = await walletService.getCoinPlans();
    const plan = plans.find((p) => p._id.toString() === planId);

    if (!plan) {
      throw new AppError(404, 'Coin plan not found');
    }

    // Create payment order
    const order = await paymentGateway.createOrder(
      plan.priceINR,
      'INR',
      `coins_${req.user.id}_${Date.now()}`
    );

    res.json({
      order: {
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
      },
      plan: {
        id: plan._id,
        name: plan.name,
        coins: plan.coins,
        priceINR: plan.priceINR,
      },
    });
  },

  /**
   * Verify payment and credit coins
   */
  async verifyPaymentAndCredit(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { orderId, paymentId, signature, planId } = req.body;

    if (!orderId || !paymentId || !signature || !planId) {
      throw new AppError(400, 'Missing required fields');
    }

    // Verify payment signature
    const isValid = await paymentGateway.verifyPayment({
      orderId,
      paymentId,
      signature,
    });

    if (!isValid) {
      throw new AppError(400, 'Invalid payment signature', 'PAYMENT_VERIFICATION_FAILED');
    }

    // Get coin plan
    const plans = await walletService.getCoinPlans();
    const plan = plans.find((p) => p._id.toString() === planId);

    if (!plan) {
      throw new AppError(404, 'Coin plan not found');
    }

    // Credit coins to user
    const newBalance = await coinService.creditCoins(
      req.user.id,
      plan.coins,
      TransactionType.PURCHASE,
      {
        orderId,
        paymentId,
        planId,
        priceINR: plan.priceINR,
      }
    );

    res.json({
      message: 'Payment verified and coins credited successfully',
      balance: newBalance,
      coinsAdded: plan.coins,
    });
  },
};
