import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { walletService } from './wallet.service';
import { coinService } from '../../services/coinService';
import { PaymentService } from '../../services/paymentService';
import { AppError } from '../../middleware/errorHandler';
import { TransactionType } from '../../models/Transaction';
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
   * Create payment order for coin purchase using Cashfree
   */
  async createPaymentOrder(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { planId } = req.body;

    if (!planId) {
      throw new AppError(400, 'Plan ID is required');
    }

    // Create payment order using PaymentService with Cashfree
    const result = await paymentService.createPaymentOrder(req.user.id, planId);

    // Log the payment session to debug
    logger.info({ paymentSession: result.paymentSession }, 'Payment session response');

    // Construct Cashfree payment URL
    // For Cashfree API v2023-08-01, use the checkout endpoint with payment_session_id
    const paymentSessionId = result.paymentSession.payment_session_id;
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://payments.cashfree.com'
      : 'https://sandbox.cashfree.com';
    const paymentLink = `${baseUrl}/pgappsdkapi/v1/checkout?payment_session_id=${paymentSessionId}`;

    res.json({
      orderId: result.orderId,
      payment_link: paymentLink,
      payment_session_id: paymentSessionId,
      amount: result.amount,
      coins: result.coins,
      planName: result.planName,
    });
  },

  /**
   * Get payment status (Cashfree handles verification via webhook)
   */
  async verifyPaymentAndCredit(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { orderId } = req.body;

    if (!orderId) {
      throw new AppError(400, 'Order ID is required');
    }

    // Get payment status from PaymentService
    const payment = await paymentService.getPaymentStatus(orderId, req.user.id);

    res.json({
      status: payment.status,
      orderId: payment.orderId,
      amount: payment.amount,
      coins: payment.coins,
    });
  },
};
