import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { paymentService } from '../../services/paymentService';
import { CoinPlan } from '../../models/CoinPlan';
import { Payment, PaymentStatus } from '../../models/Payment';
import { logger } from '../../lib/logger';
import { AppError } from '../../middleware/errorHandler';
import { coinService } from '../../services/coinService';

export class PaymentController {
  async getPlans(req: Request, res: Response) {
    try {
      const plans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });

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
      const transformedPlans = plans.map((plan, index) => {
        const planId = plan._id.toString();
        const purchaseCount = purchaseCountMap.get(planId) || 0;
        const isLastPlan = index === plans.length - 1;
        const planMaxUses = plan.maxUses || null;
        const isLocked = !isLastPlan && planMaxUses != null && purchaseCount >= planMaxUses;
        const effectiveDiscount = purchaseCount > 0 ? 0 : (plan.discount || 0);

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
      }, 'Coin plans with per-plan limits');

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
