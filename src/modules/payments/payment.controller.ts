import { Request, Response } from 'express';
import { paymentService } from '../../services/paymentService';
import { CoinPlan } from '../../models/CoinPlan';
import { logger } from '../../lib/logger';
import { AppError } from '../../middleware/errorHandler';

export class PaymentController {
  async getPlans(req: Request, res: Response) {
    try {
      const plans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });
      res.json({ plans });
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

      if (!signature) {
        throw new AppError(400, 'Missing webhook signature');
      }

      await paymentService.handlePaymentWebhook(req.body, signature, rawBody);
      
      res.json({ success: true });
    } catch (error) {
      logger.error({ error, body: req.body }, 'Failed to process payment webhook');
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
