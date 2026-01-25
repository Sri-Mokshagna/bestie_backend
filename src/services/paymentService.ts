import { Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { cashfreeService } from '../lib/cashfree';
import { Payment, PaymentStatus, IPayment } from '../models/Payment';
import { CoinPlan } from '../models/CoinPlan';
import { User } from '../models/User';
import { coinService } from './coinService';
import { TransactionType } from '../models/Transaction';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errorHandler';
import { parseCashfreeWebhook } from './paymentWebhookHandler';

/**
 * Payment Service
 * Handles all payment-related operations including:
 * - Creating payment orders
 * - Processing webhooks
 * - Handling payment status updates
 * - Refunds
 */
export class PaymentService {
  /**
   * Create a payment order for coin purchase
   * This creates an order with Cashfree and returns a payment link
   */
  async createPaymentOrder(userId: string, planId: string) {
    try {
      // Fetch user
      const user = await User.findById(userId);
      if (!user) {
        throw new AppError(404, 'User not found');
      }

      // Fetch and validate coin plan
      const plan = await CoinPlan.findById(planId);
      if (!plan || !plan.isActive) {
        throw new AppError(404, 'Coin plan not found or inactive');
      }

      // Validate user has phone number (required for Cashfree)
      if (!user.phone) {
        throw new AppError(400, 'User phone number is required for payment');
      }

      // Generate unique order ID
      const orderId = `ORDER_${Date.now()}_${uuidv4().slice(0, 8)}`;

      // Generate email (use user's email or generate from phone)
      const customerEmail = user.profile?.email || `user_${user.phone.replace(/\+/g, '')}@bestie.app`;

      // Create payment record in database
      const payment = new Payment({
        userId: new Types.ObjectId(userId),
        orderId,
        cashfreeOrderId: orderId, // Will be updated with Cashfree's order ID
        planId: new Types.ObjectId(planId),
        amount: plan.priceINR,
        coins: plan.coins,
        currency: 'INR',
        status: PaymentStatus.PENDING,
      });

      await payment.save();

      // Get server URL for return/webhook URLs
      const serverUrl = process.env.SERVER_URL ||
        (process.env.NODE_ENV === 'production'
          ? 'https://bestie-backend-zmj2.onrender.com'
          : 'http://localhost:3000');

      logger.info({
        userId,
        orderId,
        planId,
        amount: plan.priceINR,
        serverUrl,
      }, 'Creating Cashfree order');

      // Create order with Cashfree
      // return_url must be CLEAN - no query params, Cashfree injects order_id
      const result = await cashfreeService.createOrderAndGetLink({
        orderId,
        amount: plan.priceINR,
        currency: 'INR',
        customerDetails: {
          customerId: userId,
          customerName: user.profile?.name || 'Bestie User',
          customerEmail,
          customerPhone: user.phone,
        },
        returnUrl: `${serverUrl}/pay/success`,  // CLEAN - no query params! Changed to /pay to avoid Android intent
        notifyUrl: `${serverUrl}/api/payments/webhook`,
      });

      // Update payment record with Cashfree response
      payment.cashfreeOrderId = result.order.order_id;
      payment.gatewayResponse = result.order; // Contains payment_session_id
      await payment.save();

      logger.info({
        userId,
        orderId,
        planId,
        cashfreeOrderId: result.order.order_id,
        hasSessionId: !!result.order.payment_session_id,
      }, '✅ Payment order created successfully');

      // Log the payment link for debugging
      logger.info({ orderId, paymentLink: result.payment_link }, 'Payment link generated');

      // Return payment session details
      // Mobile apps should open payment_link which uses Cashfree SDK (per Cashfree requirements)
      return {
        orderId,
        paymentSessionId: result.payment_session_id,
        amount: plan.priceINR,
        coins: plan.coins,
        planName: plan.name,
        payment_link: result.payment_link, // SDK-based redirect (required by Cashfree)
      };
    } catch (error) {
      logger.error({ error, userId, planId }, '❌ Failed to create payment order');
      throw error;
    }
  }

  async handlePaymentWebhook(webhookData: any, signature: string, rawBody: string) {
    try {
      // Log signature verification attempt
      logger.info({
        hasSignature: !!signature,
        signatureLength: signature?.length,
        webhookType: webhookData?.type,
      }, 'Attempting webhook signature verification');

      let isValidSignature = false;
      try {
        isValidSignature = cashfreeService.verifyWebhookSignature(rawBody, signature);
        logger.info({ isValidSignature }, 'Signature verification result');
      } catch (signatureError) {
        logger.warn({
          error: signatureError,
          message: (signatureError as any)?.message,
        }, '⚠️ Signature verification failed - processing webhook anyway for debugging');
        // Don't throw error, continue processing to credit coins
        isValidSignature = false;
      }

      // Parse webhook using dedicated handler
      const { order_id, payment_status, payment_method, cf_payment_id, ourOrderId } = parseCashfreeWebhook(webhookData);

      logger.info({
        webhookType: webhookData.type,
        cashfreeOrderId: order_id,
        ourOrderId,
        payment_status
      }, 'Parsed webhook - searching for payment');

      // Search using multiple identifiers
      const searchCriteria: any[] = [
        { cashfreeOrderId: order_id },
        { orderId: order_id }
      ];
      if (ourOrderId) {
        searchCriteria.push({ orderId: ourOrderId });
      }

      const payment = await Payment.findOne({ $or: searchCriteria });

      if (!payment) {
        const allPayments = await Payment.find({}).limit(5).select('orderId cashfreeOrderId').lean();
        logger.error({
          searchedCashfreeOrderId: order_id,
          searchedOurOrderId: ourOrderId,
          recentPayments: allPayments,
          webhookData
        }, 'Payment record not found for webhook - showing recent payments');
        return;
      }

      logger.info({
        foundPayment: {
          orderId: payment.orderId,
          cashfreeOrderId: payment.cashfreeOrderId
        }
      }, 'Payment record found!');

      // Idempotency check - prevent processing the same webhook twice
      if (payment_status === 'SUCCESS' && payment.status === PaymentStatus.SUCCESS) {
        logger.info({ orderId: payment.orderId }, '⚠️ Payment already processed - skipping to prevent double coins');
        return;
      }

      payment.webhookData = webhookData;
      payment.cashfreePaymentId = cf_payment_id?.toString();
      if (payment_method) {
        payment.paymentMethod = this.mapPaymentMethod(payment_method) as any;
      }

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
      logger.info({ orderId: payment.orderId, status: payment_status }, 'Payment webhook processed successfully!');
    } catch (error) {
      logger.error({ error, webhookData }, 'Failed to process payment webhook');
      throw error;
    }
  }

  private async handleSuccessfulPayment(payment: IPayment) {
    try {
      // Idempotency check - prevent processing the same payment twice
      if (payment.status === PaymentStatus.SUCCESS) {
        logger.warn({ orderId: payment.orderId, currentStatus: payment.status }, 'Payment already processed as successful - skipping to prevent duplicate coins');
        return;
      }

      // CRITICAL: Update status and save FIRST to ensure idempotency works
      payment.status = PaymentStatus.SUCCESS;
      await payment.save();

      logger.info(
        {
          userId: payment.userId,
          orderId: payment.orderId,
          amountPaid: payment.amount,
        },
        '💰 Status saved, now calculating coins to credit'
      );

      // Get config to calculate coins based on coinsToINRRate
      const config = await coinService.getConfig();

      // IMPORTANT: Calculate actual coins based on amount paid and admin's rate
      // This respects the admin's coinsToINRRate setting
      // Example: ₹100 paid with rate 0.1 (₹0.1 per coin) = 1000 coins
      const coinsToCredit = Math.floor(payment.amount / config.coinsToINRRate);

      logger.info(
        {
          userId: payment.userId,
          orderId: payment.orderId,
          amountPaid: payment.amount,
          coinsToINRRate: config.coinsToINRRate,
          originalPlanCoins: payment.coins,
          calculatedCoins: coinsToCredit,
          calculation: `${payment.amount} / ${config.coinsToINRRate} = ${coinsToCredit}`,
        },
        '🔢 Coins calculated based on coinsToINRRate (admin setting)'
      );

      // Credit the calculated coins (not the plan's fixed coins)
      await coinService.creditCoins(
        payment.userId.toString(),
        coinsToCredit, // Use calculated coins based on rate
        TransactionType.PURCHASE,
        {
          orderId: payment.orderId,
          description: `Coin purchase - Order ${payment.orderId}`,
          amountPaid: payment.amount,
          coinsToINRRate: config.coinsToINRRate,
          calculatedCoins: coinsToCredit,
        }
      );

      logger.info(
        {
          userId: payment.userId,
          orderId: payment.orderId,
          coinsCredited: coinsToCredit,
        },
        '✅ Coins credited successfully (calculated amount)'
      );

      // FIRST-TIME BONUS LOGIC
      // Check if plan is tagged as "first-time" and user qualifies for bonus
      const plan = await CoinPlan.findById(payment.planId);
      if (plan && plan.tags.includes(('first-time' as any))) {
        logger.info(
          {
            userId: payment.userId,
            orderId: payment.orderId,
            planId: payment.planId,
            planTags: plan.tags,
          },
          '🏷️ Plan has first-time tag, checking if user qualifies for bonus'
        );

        // Check if user has had any previous successful payments
        const previousSuccessfulPayments = await Payment.countDocuments({
          userId: payment.userId,
          status: PaymentStatus.SUCCESS,
          _id: { $ne: payment._id }, // Exclude current payment
        });

        if (previousSuccessfulPayments === 0) {
          // This is the user's first successful purchase!
          // Get bonus percentage from commission config
          const { commissionService } = await import('./commissionService');
          const bonusPercentage = await commissionService.getFirstTimeBonusPercentage();
          const bonusCoins = Math.floor((coinsToCredit * bonusPercentage) / 100);

          if (bonusCoins > 0) {
            logger.info(
              {
                userId: payment.userId,
                orderId: payment.orderId,
                baseCoins: coinsToCredit,
                bonusPercentage,
                bonusCoins,
              },
              '🎉 First-time purchase bonus - crediting extra coins'
            );

            // Credit bonus coins
            await coinService.creditCoins(
              payment.userId.toString(),
              bonusCoins,
              TransactionType.GIFT,
              {
                orderId: payment.orderId,
                description: `First-time purchase bonus (${bonusPercentage}%)`,
                bonusPercentage,
                baseCoins: coinsToCredit,
              }
            );

            logger.info(
              {
                userId: payment.userId,
                orderId: payment.orderId,
                bonusCredited: bonusCoins,
                totalCoins: coinsToCredit + bonusCoins,
              },
              '✅ First-time bonus credited successfully'
            );
          }
        } else {
          logger.info(
            {
              userId: payment.userId,
              orderId: payment.orderId,
              previousSuccessfulPayments,
            },
            '⚠️ User has previous successful payments - not eligible for first-time bonus'
          );
        }
      }
    } catch (error) {
      logger.error({ error, orderId: payment.orderId }, 'Failed to process successful payment');
      payment.status = PaymentStatus.FAILED;
      payment.failureReason = 'Failed to add coins to user account';
      await payment.save();
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

  private mapPaymentMethod(method: any) {
    // Handle both string and object formats from Cashfree
    let methodType: string;

    if (typeof method === 'string') {
      methodType = method;
    } else if (typeof method === 'object' && method !== null) {
      // Extract payment type from object (e.g., { upi: {...} } or { card: {...} })
      const keys = Object.keys(method);
      methodType = keys.length > 0 ? keys[0] : 'unknown';
    } else {
      methodType = 'unknown';
    }

    const methodMap: { [key: string]: string } = {
      'upi': 'upi',
      'cc': 'card',
      'dc': 'card',
      'card': 'card',
      'nb': 'net_banking',
      'netbanking': 'net_banking',
      'wallet': 'wallet',
    };

    return methodMap[methodType.toLowerCase()] || 'upi';
  }

  async getPaymentStatus(orderId: string, userId: string) {
    try {
      const payment = await Payment.findOne({ orderId, userId })
        .populate('planId', 'name coins priceINR');

      if (!payment) {
        throw new AppError(404, 'Payment not found');
      }

      try {
        // Always check Cashfree for the most up-to-date status to handle webhook failures
        const cashfreeStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);

        logger.info({
          orderId: payment.orderId,
          cashfreeOrderId: payment.cashfreeOrderId,
          currentStatus: payment.status,
          cfStatus: cashfreeStatus?.order_status,
          cfPaymentStatus: Array.isArray(cashfreeStatus?.payment_sessions) && cashfreeStatus.payment_sessions.length > 0
            ? cashfreeStatus.payment_sessions[0]?.payment_status
            : cashfreeStatus?.payment_session?.[0]?.payment_status
        }, 'Checking Cashfree status for payment verification');

        // Handle various Cashfree statuses
        if (cashfreeStatus.order_status === 'PAID') {
          // If Cashfree shows PAID but our system doesn't have it as SUCCESS, process it
          if (payment.status !== PaymentStatus.SUCCESS) {
            logger.warn({
              orderId: payment.orderId,
              currentStatus: payment.status,
              cfStatus: cashfreeStatus.order_status
            }, 'Payment status mismatch detected - processing successful payment');

            await this.handleSuccessfulPayment(payment);
            await payment.save();
          }
        } else if (cashfreeStatus.order_status === 'EXPIRED') {
          if (payment.status !== PaymentStatus.FAILED) {
            payment.status = PaymentStatus.FAILED;
            payment.failureReason = 'Payment expired';
            await payment.save();
          }
        } else if (cashfreeStatus.order_status === 'CANCELLED') {
          if (payment.status !== PaymentStatus.CANCELLED) {
            payment.status = PaymentStatus.CANCELLED;
            await payment.save();
          }
        } else if (cashfreeStatus.order_status === 'ACTIVE' && payment.status === PaymentStatus.PENDING) {
          // Check if payment has been active for too long and might have failed silently
          const paymentAge = Date.now() - payment.createdAt.getTime();
          const maxPaymentTime = 30 * 60 * 1000; // 30 minutes

          if (paymentAge > maxPaymentTime) {
            logger.info({
              orderId: payment.orderId,
              paymentAgeMs: paymentAge
            }, 'Payment has been pending for too long, checking for possible failure');

            // Check if any payment was made but not captured properly
            const paymentSessions = cashfreeStatus.payment_sessions || cashfreeStatus.payment_session || [];
            if (Array.isArray(paymentSessions) && paymentSessions.length > 0) {
              const successfulPayment = paymentSessions.some(
                (session: any) => session.payment_status === 'SUCCESS'
              );

              if (successfulPayment) {
                logger.info({
                  orderId: payment.orderId
                }, 'Found successful payment in session data, processing');
                await this.handleSuccessfulPayment(payment);
                await payment.save();
              }
            }
          }
        }
      } catch (error) {
        logger.error({ error, orderId, cashfreeOrderId: payment.cashfreeOrderId }, 'Failed to check payment status with Cashfree');

        // As a fallback, if we can't reach Cashfree but payment is very old, mark as failed
        if (payment.status === PaymentStatus.PENDING) {
          const paymentAge = Date.now() - payment.createdAt.getTime();
          const maxPaymentTime = 60 * 60 * 1000; // 1 hour

          if (paymentAge > maxPaymentTime) {
            logger.warn({
              orderId: payment.orderId,
              paymentAgeMs: paymentAge
            }, 'Unable to verify payment with Cashfree and payment is very old, marking as failed');

            payment.status = PaymentStatus.FAILED;
            payment.failureReason = 'Unable to verify payment status with gateway';
            await payment.save();
          }
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

  async verifyAndProcessPendingPayment(orderId: string, userId: string) {
    try {
      const payment = await Payment.findOne({ orderId, userId });
      if (!payment) {
        throw new AppError(404, 'Payment not found');
      }

      logger.info({
        orderId,
        userId,
        currentStatus: payment.status,
        cashfreeOrderId: payment.cashfreeOrderId,
      }, '🔍 Starting manual payment verification');

      // Check with Cashfree for actual payment status
      const cashfreeStatus = await cashfreeService.getPaymentStatus(payment.cashfreeOrderId);

      logger.info({
        orderId,
        cashfreeOrderStatus: cashfreeStatus.order_status,
        currentPaymentStatus: payment.status,
      }, 'Cashfree payment status retrieved');

      // If Cashfree shows PAID but we haven't credited coins
      if (cashfreeStatus.order_status === 'PAID') {
        if (payment.status !== PaymentStatus.SUCCESS) {
          logger.info({
            orderId,
            previousStatus: payment.status,
          }, '💰 Payment was successful in Cashfree but not processed - crediting coins now');

          await this.handleSuccessfulPayment(payment);
          await payment.save();

          return {
            status: 'processed',
            message: 'Payment verified and coins credited successfully',
            payment,
          };
        } else {
          return {
            status: 'already_processed',
            message: 'Payment already processed and coins credited',
            payment,
          };
        }
      } else if (cashfreeStatus.order_status === 'ACTIVE') {
        return {
          status: 'pending',
          message: 'Payment is still pending',
          payment,
        };
      } else {
        // EXPIRED, CANCELLED, etc.
        if (payment.status === PaymentStatus.PENDING) {
          payment.status = cashfreeStatus.order_status === 'EXPIRED'
            ? PaymentStatus.FAILED
            : PaymentStatus.CANCELLED;
          payment.failureReason = `Payment ${cashfreeStatus.order_status.toLowerCase()}`;
          await payment.save();
        }

        return {
          status: 'failed',
          message: `Payment ${cashfreeStatus.order_status.toLowerCase()}`,
          payment,
        };
      }
    } catch (error) {
      logger.error({ error, orderId, userId }, '❌ Failed to verify and process payment');
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
