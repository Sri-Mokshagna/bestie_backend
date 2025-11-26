import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger';

interface CashfreeConfig {
  appId: string;
  secretKey: string;
  baseUrl: string;
  webhookSecret: string;
}

class CashfreeService {
  private config: CashfreeConfig | null = null;

  private initializeConfig() {
    if (!this.config) {
      this.config = {
        appId: process.env.CASHFREE_APP_ID!,
        secretKey: process.env.CASHFREE_SECRET_KEY!,
        baseUrl: process.env.NODE_ENV === 'production'
          ? 'https://api.cashfree.com/pg'
          : 'https://sandbox.cashfree.com/pg',
        webhookSecret: process.env.CASHFREE_WEBHOOK_SECRET!,
      };

      if (!this.config.appId || !this.config.secretKey) {
        throw new Error('Cashfree credentials not configured');
      }
    }
    return this.config;
  }

  private getHeaders() {
    const config = this.initializeConfig();
    return {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': config.appId,
      'x-client-secret': config.secretKey,
    };
  }

  async createPaymentSession(orderData: {
    orderId: string;
    amount: number;
    currency: string;
    customerDetails: {
      customerId: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
    };
    orderMeta?: {
      returnUrl?: string;
      notifyUrl?: string;
      paymentMethods?: string;
    };
  }) {
    try {
      const payload = {
        order_id: orderData.orderId,
        order_amount: orderData.amount,
        order_currency: orderData.currency,
        customer_details: {
          customer_id: orderData.customerDetails.customerId,
          customer_name: orderData.customerDetails.customerName,
          customer_email: orderData.customerDetails.customerEmail,
          customer_phone: orderData.customerDetails.customerPhone,
        },
        order_meta: {
          return_url: orderData.orderMeta?.returnUrl,
          notify_url: orderData.orderMeta?.notifyUrl,
        },
      };

      const config = this.initializeConfig();
      const response = await axios.post(
        `${config.baseUrl}/orders`,
        payload,
        { headers: this.getHeaders() }
      );

      logger.info({ orderId: orderData.orderId }, 'Payment session created');
      return response.data;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        orderId: orderData.orderId
      }, 'Failed to create payment session');
      throw error;
    }
  }

  async getPaymentStatus(orderId: string) {
    try {
      const config = this.initializeConfig();
      const response = await axios.get(
        `${config.baseUrl}/orders/${orderId}`,
        { headers: this.getHeaders() }
      );

      return response.data;
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to get payment status');
      throw error;
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      const config = this.initializeConfig();
      const expectedSignature = crypto
        .createHmac('sha256', config.webhookSecret)
        .update(rawBody)
        .digest('base64');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification failed');
      return false;
    }
  }

  async refundPayment(orderId: string, refundAmount: number, refundId: string) {
    try {
      const payload = {
        refund_amount: refundAmount,
        refund_id: refundId,
        refund_note: 'Refund for order cancellation',
      };

      const config = this.initializeConfig();
      const response = await axios.post(
        `${config.baseUrl}/orders/${orderId}/refunds`,
        payload,
        { headers: this.getHeaders() }
      );

      logger.info({ orderId, refundId }, 'Refund initiated');
      return response.data;
    } catch (error) {
      logger.error({ error, orderId, refundId }, 'Failed to initiate refund');
      throw error;
    }
  }
}

export const cashfreeService = new CashfreeService();
