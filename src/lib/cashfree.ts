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
      // Sanitize phone number
      let phone = orderData.customerDetails.customerPhone;
      phone = phone.replace(/\D/g, '');
      if (phone.startsWith('91') && phone.length === 12) {
        phone = phone.substring(2);
      }

      const payload = {
        order_id: orderData.orderId,
        order_amount: orderData.amount,
        order_currency: orderData.currency,
        customer_details: {
          customer_id: orderData.customerDetails.customerId.substring(0, 50),
          customer_name: orderData.customerDetails.customerName.substring(0, 100),
          customer_email: orderData.customerDetails.customerEmail,
          customer_phone: phone,
        },
        order_meta: {
          return_url: `${orderData.returnUrl}?order_id={order_id}`,
          notify_url: orderData.notifyUrl,
        },
      };

      const config = this.initializeConfig();

      logger.info({
        orderId: orderData.orderId,
        amount: orderData.amount,
        environment: config.baseUrl.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION',
      }, 'Creating Cashfree order');

      // Create order using Orders API
      const orderResponse = await axios.post(
        `${config.baseUrl}/orders`,
        payload,
        { headers: this.getHeaders(), timeout: 30000 }
      );

      const orderData2 = orderResponse.data;
      const paymentSessionId = orderData2.payment_session_id;

      if (!paymentSessionId) {
        logger.error({ orderResponse: orderData2 }, 'No payment_session_id in response');
        throw new Error('Payment session ID not received from Cashfree');
      }

      // Generate payment URL that points to our redirect handler
      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
      const paymentUrl = `${serverUrl}/payment/initiate?orderId=${orderData.orderId}`;

      logger.info({
        orderId: orderData.orderId,
        cashfreeOrderId: orderData2.order_id,
        hasSessionId: !!paymentSessionId,
        environment: config.baseUrl.includes('sandbox') ? 'SANDBOX' : 'PRODUCTION',
      }, 'Cashfree order created successfully');

      return {
        order: {
          ...orderData2,
          payment_session_id: paymentSessionId,
        },
        payment_link: paymentUrl,
        link_id: orderData.orderId,
        payment_session_id: paymentSessionId,
      };
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        orderId: orderData.orderId
      }, 'Failed to create order');
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
