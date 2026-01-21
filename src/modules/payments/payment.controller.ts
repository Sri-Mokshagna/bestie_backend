import { Request, Response } from 'express';
import { paymentService } from '../../services/paymentService';
import { CoinPlan } from '../../models/CoinPlan';
import { logger } from '../../lib/logger';
import { AppError } from '../../middleware/errorHandler';
import { coinService } from '../../services/coinService';

export class PaymentController {
  async getPlans(req: Request, res: Response) {
    try {
      const plans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });

      // Get coin config to calculate actual coins based on coinsToINRRate
      const config = await coinService.getConfig();

      // Transform plans to show correct coins based on admin's coinsToINRRate setting
      // Example: If rate is 0.1 (₹0.1 per coin) and price is ₹100, user gets 1000 coins
      const transformedPlans = plans.map(plan => {
        const calculatedCoins = Math.floor(plan.priceINR / config.coinsToINRRate);

        return {
          _id: plan._id,
          name: plan.name,
          priceINR: plan.priceINR,
          coins: calculatedCoins, // Calculated based on rate, not fixed value
          discount: plan.discount,
          tags: plan.tags,
          isActive: plan.isActive,
          maxUses: plan.maxUses,
          // Metadata for debugging
          _meta: {
            originalCoins: plan.coins,
            coinsToINRRate: config.coinsToINRRate,
            calculation: `${plan.priceINR} / ${config.coinsToINRRate} = ${calculatedCoins}`,
          },
        };
      });

      logger.info({
        plansCount: plans.length,
        coinsToINRRate: config.coinsToINRRate,
        sample: transformedPlans[0]?._meta,
      }, 'Coin plans calculated with dynamic rate');

      res.json({ plans: transformedPlans });
    } catch (error) {
      logger.error({ error }, 'Failed to get coin plans');
      throw error;
    }
  }

  async createOrder(req: Request, res: Response) {
    try {
      const { planId } = req.body;
      const userId = req.user!.id;

      if (!planId) {
        throw new AppError(400, 'Plan ID is required');
      }

      const order = await paymentService.createPaymentOrder(userId, planId);

      res.json({
        success: true,
        data: order,
      });
    } catch (error) {
      logger.error({ error, userId: req.user?.id, planId: req.body.planId }, 'Failed to create payment order');
      throw error;
    }
  }

  async handleWebhook(req: Request, res: Response) {
    try {
      const signature = req.headers['x-webhook-signature'] as string;
      const rawBody = JSON.stringify(req.body);

      logger.info({
        webhookType: req.body?.type,
        orderId: req.body?.data?.order?.order_id,
        paymentStatus: req.body?.data?.payment?.payment_status,
        hasSignature: !!signature,
        signatureLength: signature?.length,
        bodyKeys: Object.keys(req.body),
      }, '📨 Webhook received');

      if (!signature) {
        logger.warn({ body: req.body }, 'Webhook received without signature - processing anyway');
      }

      await paymentService.handlePaymentWebhook(req.body, signature || '', rawBody);

      logger.info({ webhookType: req.body?.type }, '✅ Webhook processed successfully');
      res.json({ success: true });
    } catch (error) {
      logger.error({
        error,
        body: req.body,
        signature: req.headers['x-webhook-signature'],
        errorMessage: (error as any)?.message,
        errorStack: (error as any)?.stack,
      }, '❌ Failed to process payment webhook');

      // Always return 200 to prevent webhook retries for invalid signatures
      res.status(200).json({ success: false, error: 'Webhook processing failed' });
    }
  }

  async getPaymentStatus(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const userId = req.user!.id;

      const payment = await paymentService.getPaymentStatus(orderId, userId);

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      logger.error({ error, orderId: req.params.orderId, userId: req.user?.id }, 'Failed to get payment status');
      throw error;
    }
  }

  async getPaymentHistory(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;

      const history = await paymentService.getUserPaymentHistory(userId, page, limit);

      res.json({
        success: true,
        data: history,
      });
    } catch (error) {
      logger.error({ error, userId: req.user?.id }, 'Failed to get payment history');
      throw error;
    }
  }

  async verifyPayment(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const userId = req.user!.id;

      logger.info({ orderId, userId }, 'Manual payment verification requested');

      const result = await paymentService.verifyAndProcessPendingPayment(orderId, userId);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error({ error, orderId: req.params.orderId, userId: req.user?.id }, 'Failed to verify payment');
      throw error;
    }
  }

  // Admin only
  async refundPayment(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      const { reason } = req.body;
      const adminId = req.user!.id;

      if (!reason) {
        throw new AppError(400, 'Refund reason is required');
      }

      const payment = await paymentService.refundPayment(orderId, adminId, reason);

      res.json({
        success: true,
        data: payment,
      });
    } catch (error) {
      logger.error({ error, orderId: req.params.orderId, adminId: req.user?.id }, 'Failed to refund payment');
      throw error;
    }
  }
}

export const paymentController = new PaymentController();
