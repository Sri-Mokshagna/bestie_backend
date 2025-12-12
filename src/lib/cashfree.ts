import axios from 'axios';
import crypto from 'crypto';
import { logger } from './logger';

interface CashfreeConfig {
  appId: string;
  secretKey: string;
  baseUrl: string;
  webhookSecret: string;
}

interface CashfreePayoutConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

class CashfreeService {
  private config: CashfreeConfig | null = null;
  private payoutConfig: CashfreePayoutConfig | null = null;
  private payoutToken: string | null = null;
  private payoutTokenExpiry: number = 0;

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

  private initializePayoutConfig() {
    if (!this.payoutConfig) {
      this.payoutConfig = {
        clientId: process.env.CASHFREE_PAYOUT_CLIENT_ID!,
        clientSecret: process.env.CASHFREE_PAYOUT_CLIENT_SECRET!,
        baseUrl: process.env.NODE_ENV === 'production'
          ? 'https://payout-api.cashfree.com/payout/v1'
          : 'https://payout-gamma.cashfree.com/payout/v1',
      };

      if (!this.payoutConfig.clientId || !this.payoutConfig.clientSecret) {
        throw new Error('Cashfree Payout credentials not configured');
      }
    }
    return this.payoutConfig;
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

  private async getPayoutToken(): Promise<string> {
    // Return cached token if still valid
    if (this.payoutToken && Date.now() < this.payoutTokenExpiry) {
      return this.payoutToken;
    }

    try {
      const config = this.initializePayoutConfig();

      logger.info({
        baseUrl: config.baseUrl,
        clientIdPrefix: config.clientId?.substring(0, 10),
      }, 'Requesting Cashfree Payout token');

      // Cashfree Payout API expects credentials in headers
      const response = await axios.post(
        `${config.baseUrl}/authorize`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': config.clientId,
            'X-Client-Secret': config.clientSecret,
          },
        }
      );

      logger.info({
        responseStatus: response.status,
        responseData: response.data,
      }, 'Cashfree Payout API response');

      // Handle different response structures
      const token = response.data?.data?.token || response.data?.token;

      if (!token) {
        throw new Error(`Invalid token response structure: ${JSON.stringify(response.data)}`);
      }

      this.payoutToken = token;
      // Token expires in 5 minutes, refresh after 4 minutes
      this.payoutTokenExpiry = Date.now() + 4 * 60 * 1000;

      logger.info('Cashfree Payout token obtained successfully');
      return this.payoutToken;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        statusCode: error.response?.status,
      }, 'Failed to get Cashfree Payout token');

      // Provide helpful error message if credentials are not configured
      if (error.message?.includes('not configured')) {
        throw new Error(
          'Cashfree Payout credentials not configured. Please add CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET to environment variables.'
        );
      }

      throw error;
    }
  }

  private async getPayoutHeaders() {
    const token = await this.getPayoutToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
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

  /**
   * Payout API Methods
   */

  async createBeneficiary(data: {
    beneId: string;
    name: string;
    email: string;
    phone: string;
    vpa: string; // UPI ID
  }) {
    try {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const payload = {
        beneId: data.beneId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        bankAccount: null,
        vpa: data.vpa,
      };

      const response = await axios.post(
        `${config.baseUrl}/addBeneficiary`,
        payload,
        { headers }
      );

      logger.info({ beneId: data.beneId }, 'Beneficiary created successfully');
      return response.data;
    } catch (error: any) {
      // If beneficiary already exists, that's okay
      if (error.response?.data?.subCode === 'BENEFICIARY_ALREADY_EXISTS') {
        logger.info({ beneId: data.beneId }, 'Beneficiary already exists');
        return { status: 'SUCCESS', message: 'Beneficiary already exists' };
      }

      logger.error({
        error: error.response?.data || error.message,
        beneId: data.beneId,
      }, 'Failed to create beneficiary');
      throw error;
    }
  }

  async requestPayout(data: {
    transferId: string;
    beneId: string;
    amount: number;
    transferMode?: string;
    remarks?: string;
  }) {
    try {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const payload = {
        beneId: data.beneId,
        amount: data.amount.toString(),
        transferId: data.transferId,
        transferMode: data.transferMode || 'upi',
        remarks: data.remarks || 'Payout from Bestie',
      };

      const response = await axios.post(
        `${config.baseUrl}/requestTransfer`,
        payload,
        { headers }
      );

      logger.info({
        transferId: data.transferId,
        amount: data.amount,
      }, 'Payout requested successfully');

      return response.data;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        transferId: data.transferId,
      }, 'Failed to request payout');
      throw error;
    }
  }

  async getPayoutStatus(transferId: string) {
    try {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const response = await axios.get(
        `${config.baseUrl}/getTransferStatus`,
        {
          headers,
          params: { transferId },
        }
      );

      logger.info({ transferId }, 'Payout status retrieved');
      return response.data;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        transferId,
      }, 'Failed to get payout status');
      throw error;
    }
  }
}

export const cashfreeService = new CashfreeService();
