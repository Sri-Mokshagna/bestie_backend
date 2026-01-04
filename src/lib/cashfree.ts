import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { logger } from './logger';

/**
 * Cashfree Payment Gateway Configuration
 * Production-ready implementation with proper environment detection
 */
interface CashfreeConfig {
  appId: string;
  secretKey: string;
  baseUrl: string;
  webhookSecret: string;
  isProduction: boolean;
}

/**
 * Cashfree Payout API Configuration
 * Supports both V1 (legacy) and V2 (new) APIs
 */
interface CashfreePayoutConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  isProduction: boolean;
}

/**
 * Retry configuration for API calls
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
};

/**
 * Production-ready Cashfree Service
 * Handles both Payment Gateway and Payout APIs
 */
class CashfreeService {
  private config: CashfreeConfig | null = null;
  private payoutConfig: CashfreePayoutConfig | null = null;
  private payoutToken: string | null = null;
  private payoutTokenExpiry: number = 0;

  /**
   * Detect if credentials are for production or sandbox
   * Cashfree test credentials have specific patterns:
   * - App ID starts with 'TEST' (e.g., TEST10872051...)
   * - Secret key contains '_test_' or 'test' (e.g., cfsk_ma_test_...)
   */
  private detectEnvironment(appId?: string, secretKey?: string): boolean {
    // If NODE_ENV is explicitly set to production, respect it
    if (process.env.NODE_ENV === 'production') {
      // But still warn if using test credentials in production
      const hasTestCreds = appId?.includes('TEST') || 
        secretKey?.includes('_test_') || 
        secretKey?.includes('test');
      
      if (hasTestCreds) {
        logger.warn('⚠️ Using TEST credentials in production environment! Payments will use SANDBOX mode.');
        return false; // Use sandbox even in production if test creds are used
      }
      return true;
    }
    
    // Auto-detect based on credentials
    const isTestCreds = appId?.includes('TEST') || 
      secretKey?.includes('_test_') || 
      secretKey?.includes('test');
    
    return !isTestCreds;
  }

  /**
   * Initialize Payment Gateway configuration
   */
  private initializeConfig(): CashfreeConfig {
    if (!this.config) {
      const appId = process.env.CASHFREE_APP_ID;
      const secretKey = process.env.CASHFREE_SECRET_KEY;
      const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET || '';

      if (!appId || !secretKey) {
        throw new Error(
          'Cashfree credentials not configured. ' +
          'Please set CASHFREE_APP_ID and CASHFREE_SECRET_KEY environment variables.'
        );
      }

      const isProduction = this.detectEnvironment(appId, secretKey);

      this.config = {
        appId,
        secretKey,
        baseUrl: isProduction
          ? 'https://api.cashfree.com/pg'
          : 'https://sandbox.cashfree.com/pg',
        webhookSecret,
        isProduction,
      };

      logger.info({
        environment: isProduction ? 'PRODUCTION' : 'SANDBOX',
        baseUrl: this.config.baseUrl,
        appIdPrefix: appId.substring(0, 15) + '...',
      }, '💳 Cashfree Payment Gateway initialized');
    }
    return this.config;
  }

  /**
   * Initialize Payout API configuration
   * Supports Cashfree Payout API V2
   */
  private initializePayoutConfig(): CashfreePayoutConfig {
    if (!this.payoutConfig) {
      const clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID;
      const clientSecret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error(
          'Cashfree Payout credentials not configured. ' +
          'Please set CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET environment variables.'
        );
      }

      // Detect payout environment based on credentials or payment gateway config
      const pgConfig = this.config || this.initializeConfig();
      const isProduction = pgConfig.isProduction;

      this.payoutConfig = {
        clientId,
        clientSecret,
        // Payout API V2 endpoints
        baseUrl: isProduction
          ? 'https://payout-api.cashfree.com/payout/v1'
          : 'https://payout-gamma.cashfree.com/payout/v1',
        isProduction,
      };

      logger.info({
        environment: isProduction ? 'PRODUCTION' : 'SANDBOX',
        baseUrl: this.payoutConfig.baseUrl,
        clientIdPrefix: clientId.substring(0, 10) + '...',
      }, '💸 Cashfree Payout API initialized');
    }
    return this.payoutConfig;
  }

  /**
   * Get headers for Payment Gateway API (v2023-08-01)
   */
  private getHeaders() {
    const config = this.initializeConfig();
    return {
      'Content-Type': 'application/json',
      'x-api-version': '2023-08-01',
      'x-client-id': config.appId,
      'x-client-secret': config.secretKey,
    };
  }

  /**
   * Retry wrapper for API calls with exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;
        
        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error.response?.status >= 400 && error.response?.status < 500 && error.response?.status !== 429) {
          throw error;
        }
        
        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delay = Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(2, attempt),
            RETRY_CONFIG.maxDelay
          );
          
          logger.warn({
            operation: operationName,
            attempt: attempt + 1,
            delay,
            error: error.message,
          }, `Retrying ${operationName} after ${delay}ms`);
          
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Get authentication token for Payout API
   * Tokens are cached and refreshed before expiry
   */
  private async getPayoutToken(): Promise<string> {
    // Return cached token if still valid (with 30 second buffer)
    if (this.payoutToken && Date.now() < this.payoutTokenExpiry - 30000) {
      return this.payoutToken;
    }

    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();

      logger.info({
        baseUrl: config.baseUrl,
        clientIdPrefix: config.clientId?.substring(0, 10),
      }, 'Requesting Cashfree Payout token');

      const response = await axios.post(
        `${config.baseUrl}/authorize`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': config.clientId,
            'X-Client-Secret': config.clientSecret,
          },
          timeout: 15000,
        }
      );

      // Handle different response structures from Cashfree
      const token = response.data?.data?.token || response.data?.token;
      const expiresAt = response.data?.data?.expiry || response.data?.expiry;

      if (!token) {
        throw new Error(`Invalid token response: ${JSON.stringify(response.data)}`);
      }

      this.payoutToken = token;
      // Set expiry based on response or default to 4 minutes
      this.payoutTokenExpiry = expiresAt 
        ? new Date(expiresAt).getTime() 
        : Date.now() + 4 * 60 * 1000;

      logger.info('✅ Cashfree Payout token obtained successfully');
      return this.payoutToken;
    }, 'getPayoutToken');
  }

  /**
   * Get headers for Payout API calls
   */
  private async getPayoutHeaders() {
    const token = await this.getPayoutToken();
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Create a payment order and get payment session
   * Uses Cashfree Orders API (v2023-08-01)
   */
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
    return this.withRetry(async () => {
      const config = this.initializeConfig();

      // Sanitize and validate phone number (must be 10 digits for India)
      let phone = orderData.customerDetails.customerPhone;
      phone = phone.replace(/\D/g, ''); // Remove non-digits
      if (phone.startsWith('91') && phone.length === 12) {
        phone = phone.substring(2); // Remove country code
      }
      if (phone.length !== 10) {
        logger.warn({ phone: orderData.customerDetails.customerPhone }, 'Invalid phone number format');
      }

      // Prepare order payload
      // NOTE: Do NOT include return_url when using direct redirect to checkout
      // Cashfree invalidates sessions opened via redirect when return_url is present
      // Handle post-payment via webhook + polling instead
      const payload = {
        order_id: orderData.orderId,
        order_amount: orderData.amount,
        order_currency: orderData.currency,
        customer_details: {
          customer_id: orderData.customerDetails.customerId.substring(0, 50), // Max 50 chars
          customer_name: orderData.customerDetails.customerName.substring(0, 100), // Max 100 chars
          customer_email: orderData.customerDetails.customerEmail,
          customer_phone: phone,
        },
        order_meta: {
          // Only notify_url - NO return_url to allow direct redirect
          notify_url: orderData.notifyUrl,
        },
        order_tags: {
          original_order_id: orderData.orderId,
          source: 'bestie_app',
        },
      };

      logger.info({
        orderId: orderData.orderId,
        amount: orderData.amount,
        environment: config.isProduction ? 'PRODUCTION' : 'SANDBOX',
      }, 'Creating Cashfree order');

      const response = await axios.post(
        `${config.baseUrl}/orders`,
        payload,
        { 
          headers: this.getHeaders(),
          timeout: 30000, // 30 second timeout for order creation
        }
      );

      const orderResponse = response.data;

      // Log the full response for debugging
      logger.info({
        orderId: orderData.orderId,
        responseKeys: Object.keys(orderResponse),
        hasPaymentSessionId: !!orderResponse.payment_session_id,
        hasPaymentLink: !!orderResponse.payment_link,
        hasLinkUrl: !!orderResponse.link_url,
        orderStatus: orderResponse.order_status,
      }, 'Cashfree order response details');

      // Extract payment session ID (critical for Drop component)
      const paymentSessionId = orderResponse.payment_session_id;
      
      if (!paymentSessionId) {
        logger.error({ 
          orderResponse,
          orderId: orderData.orderId 
        }, 'No payment_session_id in response');
        throw new Error('Payment session ID not received from Cashfree');
      }

      // Generate payment URL that points to our redirect handler
      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
      const paymentUrl = `${serverUrl}/payment/initiate?orderId=${orderData.orderId}`;
      
      // Also generate the direct Cashfree checkout URL
      const directCheckoutUrl = config.isProduction
        ? `https://payments.cashfree.com/order/#${paymentSessionId}`
        : `https://payments-test.cashfree.com/order/#${paymentSessionId}`;

      logger.info({
        orderId: orderData.orderId,
        cashfreeOrderId: orderResponse.order_id,
        orderStatus: orderResponse.order_status,
        hasSessionId: !!paymentSessionId,
        sessionIdLength: paymentSessionId?.length,
        directCheckoutUrl,
        environment: config.isProduction ? 'PRODUCTION' : 'SANDBOX',
      }, '✅ Cashfree order created successfully');

      return {
        order: {
          ...orderResponse,
          // Store which environment this order was created in
          _cashfree_environment: config.isProduction ? 'production' : 'sandbox',
          // Store the direct checkout URL for debugging
          _direct_checkout_url: directCheckoutUrl,
        },
        payment_link: paymentUrl,
        direct_checkout_url: directCheckoutUrl,
        link_id: orderData.orderId,
        payment_session_id: paymentSessionId,
      };
    }, 'createOrderAndGetLink');
  }

  /**
   * Get payment status from Cashfree
   * Useful for verifying payment state and handling redirects
   */
  async getPaymentStatus(orderId: string) {
    return this.withRetry(async () => {
      const config = this.initializeConfig();
      const response = await axios.get(
        `${config.baseUrl}/orders/${orderId}`,
        { 
          headers: this.getHeaders(),
          timeout: 15000,
        }
      );

      logger.info({
        orderId,
        orderStatus: response.data?.order_status,
      }, 'Payment status retrieved');

      return response.data;
    }, 'getPaymentStatus');
  }

  /**
   * Get order payments (all payment attempts for an order)
   */
  async getOrderPayments(orderId: string) {
    return this.withRetry(async () => {
      const config = this.initializeConfig();
      const response = await axios.get(
        `${config.baseUrl}/orders/${orderId}/payments`,
        { 
          headers: this.getHeaders(),
          timeout: 15000,
        }
      );

      return response.data;
    }, 'getOrderPayments');
  }

  /**
   * Verify webhook signature from Cashfree
   * In production, this verifies the webhook authenticity
   * In sandbox/test mode, verification is skipped
   */
  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    try {
      const config = this.initializeConfig();

      // Skip verification if no webhook secret configured or in test mode
      if (!config.webhookSecret || 
          config.webhookSecret === 'test_skip_verification' ||
          !config.isProduction) {
        logger.info({
          reason: !config.webhookSecret ? 'no_secret' : 
                  config.webhookSecret === 'test_skip_verification' ? 'skip_flag' : 'sandbox_mode'
        }, 'Skipping webhook signature verification');
        return true;
      }

      // Cashfree uses HMAC-SHA256 for webhook signatures
      const expectedSignature = crypto
        .createHmac('sha256', config.webhookSecret)
        .update(rawBody)
        .digest('base64');

      // Use timing-safe comparison to prevent timing attacks
      const isValid = signature.length === expectedSignature.length &&
        crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        );

      if (!isValid) {
        logger.error({
          receivedSignature: signature.substring(0, 20) + '...',
          expectedLength: expectedSignature.length,
          receivedLength: signature.length,
        }, '❌ Webhook signature verification failed');
      } else {
        logger.info('✅ Webhook signature verification passed');
      }

      return isValid;
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification error');
      return false;
    }
  }

  /**
   * Initiate a refund for a payment
   */
  async refundPayment(orderId: string, refundAmount: number, refundId: string, note?: string) {
    return this.withRetry(async () => {
      const config = this.initializeConfig();
      
      const payload = {
        refund_amount: refundAmount,
        refund_id: refundId,
        refund_note: note || 'Refund for order cancellation',
      };

      const response = await axios.post(
        `${config.baseUrl}/orders/${orderId}/refunds`,
        payload,
        { 
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      logger.info({ orderId, refundId, refundAmount }, '✅ Refund initiated');
      return response.data;
    }, 'refundPayment');
  }

  /**
   * ============================================
   * PAYOUT API METHODS
   * ============================================
   * For sending money to responders via UPI/Bank
   */

  /**
   * Create or update a beneficiary for payouts
   * A beneficiary is required before making a payout
   */
  async createBeneficiary(data: {
    beneId: string;
    name: string;
    email: string;
    phone: string;
    vpa: string; // UPI ID (e.g., name@paytm)
    bankAccount?: string;
    ifsc?: string;
    address1?: string;
  }) {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      // Clean phone number
      let phone = data.phone.replace(/\D/g, '');
      if (phone.startsWith('91') && phone.length === 12) {
        phone = phone.substring(2);
      }

      const payload: any = {
        beneId: data.beneId,
        name: data.name.substring(0, 100),
        email: data.email,
        phone: phone,
        address1: data.address1 || 'India',
      };

      // Add either VPA (UPI) or bank account
      if (data.vpa) {
        payload.vpa = data.vpa;
      }
      if (data.bankAccount && data.ifsc) {
        payload.bankAccount = data.bankAccount;
        payload.ifsc = data.ifsc;
      }

      logger.info({
        beneId: data.beneId,
        hasVpa: !!data.vpa,
        hasBankAccount: !!data.bankAccount,
      }, 'Creating beneficiary');

      const response = await axios.post(
        `${config.baseUrl}/addBeneficiary`,
        payload,
        {
          headers,
          timeout: 20000,
        }
      );

      logger.info({ beneId: data.beneId }, '✅ Beneficiary created successfully');
      return response.data;
    }, 'createBeneficiary').catch((error: any) => {
      // If beneficiary already exists, that's okay - return success
      if (error.response?.data?.subCode === 'BENEFICIARY_ALREADY_EXISTS' ||
          error.response?.data?.message?.includes('already exists')) {
        logger.info({ beneId: data.beneId }, 'Beneficiary already exists - OK');
        return { status: 'SUCCESS', message: 'Beneficiary already exists', subCode: 'BENEFICIARY_ALREADY_EXISTS' };
      }

      logger.error({
        error: error.response?.data || error.message,
        beneId: data.beneId,
        status: error.response?.status,
      }, '❌ Failed to create beneficiary');
      throw error;
    });
  }

  /**
   * Get beneficiary details
   */
  async getBeneficiary(beneId: string) {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const response = await axios.get(
        `${config.baseUrl}/getBeneficiary/${beneId}`,
        {
          headers,
          timeout: 15000,
        }
      );

      return response.data;
    }, 'getBeneficiary');
  }

  /**
   * Request a payout transfer to a beneficiary
   * Supports UPI and bank transfer modes
   */
  async requestPayout(data: {
    transferId: string;
    beneId: string;
    amount: number;
    transferMode?: 'upi' | 'banktransfer' | 'imps' | 'neft';
    remarks?: string;
  }) {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      // Validate minimum amount (Cashfree minimum is ₹1)
      if (data.amount < 1) {
        throw new Error('Minimum payout amount is ₹1');
      }

      const payload = {
        beneId: data.beneId,
        amount: data.amount.toFixed(2), // Cashfree expects string with 2 decimal places
        transferId: data.transferId,
        transferMode: data.transferMode || 'upi',
        remarks: data.remarks || 'Payout from Bestie App',
      };

      logger.info({
        transferId: data.transferId,
        amount: data.amount,
        beneId: data.beneId,
        mode: payload.transferMode,
      }, '💸 Requesting payout');

      const response = await axios.post(
        `${config.baseUrl}/requestTransfer`,
        payload,
        {
          headers,
          timeout: 30000, // 30 second timeout for payout operations
        }
      );

      logger.info({
        transferId: data.transferId,
        amount: data.amount,
        referenceId: response.data?.referenceId,
      }, '✅ Payout requested successfully');

      return response.data;
    }, 'requestPayout');
  }

  /**
   * Get payout transfer status
   */
  async getPayoutStatus(transferId: string) {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const response = await axios.get(
        `${config.baseUrl}/getTransferStatus`,
        {
          headers,
          params: { transferId },
          timeout: 15000,
        }
      );

      logger.info({ 
        transferId, 
        status: response.data?.transfer?.status 
      }, 'Payout status retrieved');
      
      return response.data;
    }, 'getPayoutStatus');
  }

  /**
   * Get payout balance
   */
  async getPayoutBalance() {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const response = await axios.get(
        `${config.baseUrl}/getBalance`,
        {
          headers,
          timeout: 15000,
        }
      );

      logger.info({ 
        balance: response.data?.data?.balance 
      }, 'Payout balance retrieved');
      
      return response.data;
    }, 'getPayoutBalance');
  }

  /**
   * Verify a VPA (UPI ID) is valid
   */
  async verifyVPA(vpa: string, name: string) {
    return this.withRetry(async () => {
      const config = this.initializePayoutConfig();
      const headers = await this.getPayoutHeaders();

      const response = await axios.get(
        `${config.baseUrl}/validation/upiDetails`,
        {
          headers,
          params: { vpa, name },
          timeout: 15000,
        }
      );

      logger.info({ vpa, isValid: response.data?.status === 'SUCCESS' }, 'VPA verification result');
      return response.data;
    }, 'verifyVPA');
  }

  /**
   * Get current configuration status (for debugging)
   */
  getConfigStatus() {
    const pgConfig = this.config;
    const payoutCfg = this.payoutConfig;

    return {
      paymentGateway: {
        configured: !!pgConfig,
        environment: pgConfig?.isProduction ? 'PRODUCTION' : 'SANDBOX',
        baseUrl: pgConfig?.baseUrl,
        hasWebhookSecret: !!pgConfig?.webhookSecret && pgConfig.webhookSecret !== 'test_skip_verification',
      },
      payout: {
        configured: !!payoutCfg,
        environment: payoutCfg?.isProduction ? 'PRODUCTION' : 'SANDBOX',
        baseUrl: payoutCfg?.baseUrl,
        hasToken: !!this.payoutToken,
        tokenExpiry: this.payoutTokenExpiry ? new Date(this.payoutTokenExpiry).toISOString() : null,
      },
    };
  }
}

// Export singleton instance
export const cashfreeService = new CashfreeService();

// Export types for use elsewhere
export type { CashfreeConfig, CashfreePayoutConfig };
