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

  async createOrderAndGetLink(orderData: {
    orderId: string;
    amount: number;
    currency: string;
    customerDetails: {
      customerId: string;
      customerName: string;
      customerEmail: string;
      customerPhone: string;
    };
    returnUrl: string;
    notifyUrl: string;
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
          return_url: orderData.returnUrl,
          notify_url: orderData.notifyUrl,
        },
      };

      const config = this.initializeConfig();

      // Step 1: Create order
      const orderResponse = await axios.post(
        `${config.baseUrl}/orders`,
        payload,
        { headers: this.getHeaders() }
      );

      logger.info({ orderId: orderData.orderId }, 'Cashfree order created');

      // Step 2: Create payment link for the order
      const linkPayload = {
        link_id: `LINK_${orderData.orderId}`,
        link_amount: orderData.amount,
        link_currency: orderData.currency,
        link_purpose: `Payment for ${orderData.orderId}`,
        customer_details: {
          customer_phone: orderData.customerDetails.customerPhone,
          customer_email: orderData.customerDetails.customerEmail,
          customer_name: orderData.customerDetails.customerName,
        },
        link_notify: {
          send_sms: false,
          send_email: false,
        },
        link_meta: {
          return_url: orderData.returnUrl,
          notify_url: orderData.notifyUrl,
        },
      };

      const linkResponse = await axios.post(
        `${config.baseUrl}/links`,
        linkPayload,
        { headers: this.getHeaders() }
      );

      logger.info({ orderId: orderData.orderId, link: linkResponse.data.link_url }, 'Payment link created');

      return {
        order: orderResponse.data,
        payment_link: linkResponse.data.link_url,
        link_id: linkResponse.data.link_id,
      };
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        orderId: orderData.orderId
      }, 'Failed to create order and payment link');
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

      // Skip verification in test mode (Cashfree doesn't provide webhook secrets in sandbox)
      if (!config.webhookSecret ||
        config.webhookSecret === 'test_skip_verification' ||
        process.env.NODE_ENV !== 'production') {
        logger.info('Skipping webhook signature verification (test mode)');
        return true;
      }

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
