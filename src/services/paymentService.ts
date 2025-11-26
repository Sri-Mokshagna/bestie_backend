import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { cashfreeService } from '../lib/cashfree';
import { Payment, PaymentStatus, IPayment } from '../models/Payment';
import { CoinPlan, ICoinPlan } from '../models/CoinPlan';
import { User } from '../models/User';
import { coinService } from './coinService';
import { TransactionType } from '../models/Transaction';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errorHandler';

export class PaymentService {
  async createPaymentOrder(userId: string, planId: string) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError(404, 'User not found');
      }

      const plan = await CoinPlan.findById(planId);
      if (!plan || !plan.isActive) {
        throw new AppError(404, 'Coin plan not found or inactive');
      }

      if (!user.phone) {
        throw new AppError(400, 'User phone number is required for payment');
      }

      const customerEmail = user.profile?.email || `${user.phone.replace('+', '')}@bestie.app`;
      const orderId = `ORDER_${Date.now()}_${uuidv4().slice(0, 8)}`;

      const payment = new Payment({
        userId: new Types.ObjectId(userId),
        orderId,
        cashfreeOrderId: orderId,
        planId: new Types.ObjectId(planId),
        amount: plan.priceINR,
        coins: plan.coins,
        currency: 'INR',
        status: PaymentStatus.PENDING,
      });

      await payment.save();

      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';

      const paymentSession = await cashfreeService.createPaymentSession({
        orderId,
        amount: plan.priceINR,
        currency: 'INR',
        customerDetails: {
          customerId: userId,
          customerName: user.profile?.name || 'User',
          customerEmail,
          customerPhone: user.phone,
        },
        orderMeta: {
          returnUrl: `${serverUrl}/payment/success?orderId=${orderId}`,
          notifyUrl: `${serverUrl}/api/payments/webhook`,
        },
      });

      payment.cashfreeOrderId = paymentSession.order_id;
      payment.gatewayResponse = paymentSession;
      await payment.save();

      logger.info({ userId, orderId, planId }, 'Payment order created');

      return {
        orderId,
        paymentSession,
        amount: plan.priceINR,
        coins: plan.coins,
        planName: plan.name,
      };
    } catch (error) {
      logger.error({ error, userId, planId }, 'Failed to create payment order');
      throw error;
    }
  }

  async handlePaymentWebhook(webhookData: any, signature: string, rawBody: string) {
    try {
      const isValidSignature = cashfreeService.verifyWebhookSignature(rawBody, signature);
      if (!isValidSignature) {
        throw new AppError(400, 'Invalid webhook signature');
      }

      const { order_id, payment_status, payment_method, cf_payment_id } = webhookData;

      const payment = await Payment.findOne({ orderId: order_id });
      if (!payment) {
        logger.warn({ orderId: order_id }, 'Payment record not found for webhook');
        return;
      }

      payment.webhookData = webhookData;
      payment.cashfreePaymentId = cf_payment_id;
      payment.paymentMethod = this.mapPaymentMethod(payment_method) as any;

      switch (payment_status) {
        case 'SUCCESS':
          await this.handleSuccessfulPayment(payment);
          break;
        case 'FAILED':
          await this.handleFailedPayment(payment, webhookData);
          break;
        case 'CANCELLED':
          await this.handleCancelledPayment(payment);
          break;
        default:
          logger.warn({ orderId: order_id, status: payment_status }, 'Unknown payment status');
      }

      await payment.save();
      logger.info({ orderId: order_id, status: payment_status }, 'Payment webhook processed');
    } catch (error) {
      logger.error({ error, webhookData }, 'Failed to process payment webhook');
      throw error;
    }
  }

  private async handleSuccessfulPayment(payment: IPayment) {
    try {
      if (payment.status === PaymentStatus.SUCCESS) {
        logger.warn({ orderId: payment.orderId }, 'Payment already processed as successful');
        return;
      }

      payment.status = PaymentStatus.SUCCESS;

      await coinService.creditCoins(
        payment.userId.toString(),
        payment.coins,
        TransactionType.PURCHASE,
        { orderId: payment.orderId, description: `Coin purchase - Order ${payment.orderId}` }
      );

      logger.info(
        {
          userId: payment.userId,
          orderId: payment.orderId,
          coins: payment.coins
        },
        'Coins added for successful payment'
      );
    } catch (error) {
      logger.error({ error, orderId: payment.orderId }, 'Failed to process successful payment');
      payment.status = PaymentStatus.FAILED;
      payment.failureReason = 'Failed to add coins to user account';
      throw error;
    }
  }

  private async handleFailedPayment(payment: IPayment, webhookData: any) {
    payment.status = PaymentStatus.FAILED;
    payment.failureReason = webhookData.failure_reason || 'Payment failed';

    logger.info(
      {
        userId: payment.userId,
        orderId: payment.orderId,
        reason: payment.failureReason
      },
      'Payment failed'
    );
  }

  private async handleCancelledPayment(payment: IPayment) {
    payment.status = PaymentStatus.CANCELLED;

    logger.info(
      {
        userId: payment.userId,
        orderId: payment.orderId
      },
      'Payment cancelled'
    );
  }

  private mapPaymentMethod(method: string) {
    const methodMap: { [key: string]: string } = {
      'upi': 'upi',
      'cc': 'card',
      'dc': 'card',
      'nb': 'net_banking',
      'wallet': 'wallet',
    };
    return methodMap[method] || method;
  }

  async getPaymentStatus(orderId: string, userId: string) {
    try {
      const payment = await Payment.findOne({ orderId, userId })
        .populate('planId', 'name coins priceINR');

      if (!payment) {
        throw new AppError(404, 'Payment not found');
      }

      if (payment.status === PaymentStatus.PENDING) {
        try {
          const cashfreeStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);

          if (cashfreeStatus.order_status === 'PAID') {
            await this.handleSuccessfulPayment(payment);
            await payment.save();
          } else if (cashfreeStatus.order_status === 'EXPIRED') {
            payment.status = PaymentStatus.FAILED;
            payment.failureReason = 'Payment expired';
            await payment.save();
          }
        } catch (error) {
          logger.warn({ error, orderId }, 'Failed to check payment status with Cashfree');
        }
      }

      return payment;
    } catch (error) {
      logger.error({ error, orderId, userId }, 'Failed to get payment status');
      throw error;
    }
  }

  async getUserPaymentHistory(userId: string, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;

      const payments = await Payment.find({ userId })
        .populate('planId', 'name coins priceINR')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await Payment.countDocuments({ userId });

      return {
        payments,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get user payment history');
      throw error;
    }
  }

  async refundPayment(orderId: string, adminId: string, reason: string) {
    try {
      const payment = await Payment.findOne({ orderId });
      if (!payment) {
        throw new AppError(404, 'Payment not found');
      }

      if (payment.status !== PaymentStatus.SUCCESS) {
        throw new AppError(400, 'Only successful payments can be refunded');
      }

      if (payment.refundId) {
        throw new AppError(400, 'Payment already refunded');
      }

      const refundId = `REFUND_${Date.now()}_${uuidv4().slice(0, 8)}`;

      const refundResponse = await cashfreeService.refundPayment(
        payment.cashfreeOrderId,
        payment.amount,
        refundId
      );

      await coinService.creditCoins(
        payment.userId.toString(),
        -payment.coins,
        TransactionType.REFUND,
        { orderId: payment.orderId, description: `Refund - Order ${payment.orderId}` }
      );

      payment.status = PaymentStatus.REFUNDED;
      payment.refundId = refundId;
      payment.refundAmount = payment.amount;
      payment.gatewayResponse = { ...payment.gatewayResponse, refund: refundResponse };
      await payment.save();

      logger.info(
        {
          orderId,
          refundId,
          adminId,
          reason
        },
        'Payment refunded successfully'
      );

      return payment;
    } catch (error) {
      logger.error({ error, orderId, adminId }, 'Failed to refund payment');
      throw error;
    }
  }
}

export const paymentService = new PaymentService();
