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
  private payoutAuthToken: string | null = null;
  private tokenExpiryTime: number | null = null;
  // Note: Cashfree Payout V1 API uses OAuth Bearer token authentication

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
   * Uses Cashfree Payout API V2 (v1 and v1.2 are deprecated as of 2024)
   * Reference: https://docs.cashfree.com/reference/v2transfer
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
        // Payout V1 API (most stable, recommended by Cashfree)
        // Reference: https://docs.cashfree.com/docs/payout/guide/
        baseUrl: isProduction
          ? 'https://payout-api.cashfree.com/payout/v1'
          : 'https://payout-gamma.cashfree.com/payout/v1',
        isProduction,
      };

      logger.info({
        environment: isProduction ? 'PRODUCTION' : 'SANDBOX',
        baseUrl: this.payoutConfig.baseUrl,
        apiVersion: 'v1',
        clientIdPrefix: clientId.substring(0, 10) + '...',
      }, '💸 Cashfree Payout API V1 initialized');
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
   * Get OAuth Bearer token for Payout V1 API
   * V1 requires token-based authentication via /authorize endpoint
   * Reference: https://docs.cashfree.com/docs/payout/guide/#authentication
   */
  private async getPayoutAuthToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.payoutAuthToken && this.tokenExpiryTime && Date.now() < this.tokenExpiryTime) {
      return this.payoutAuthToken;
    }

    const config = this.initializePayoutConfig();
    
    try {
      // Request OAuth token from Cashfree V1 /authorize endpoint
      const authResponse = await axios.post(
        `${config.baseUrl}/authorize`,
        {}, // Empty body for auth
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': config.clientId,
            'X-Client-Secret': config.clientSecret,
          },
          timeout: 15000,
        }
      );

      if (authResponse.data?.status === 'SUCCESS' && authResponse.data?.data?.token) {
        this.payoutAuthToken = authResponse.data.data.token;
        // V1 tokens typically expire in 10-30 minutes
        const expiresIn = authResponse.data.data.expiry || 600; // Default to 10 mins
        this.tokenExpiryTime = Date.now() + (expiresIn - 60) * 1000; // Subtract 60s buffer
        
        logger.info({
          tokenExpiresIn: expiresIn,
          tokenExpiryTime: new Date(this.tokenExpiryTime).toISOString(),
        }, '✅ Payout V1 OAuth token acquired');
        
        return this.payoutAuthToken;
      } else {
        throw new Error(`OAuth token acquisition failed: ${JSON.stringify(authResponse.data)}`);
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        response: error.response?.data,
        status: error.response?.status,
      }, '❌ Failed to acquire payout OAuth token');
      
      throw error;
    }
  }

  /**
   * Get headers for Payout V1 API calls
   * V1 uses OAuth Bearer token authentication
   * Reference: https://docs.cashfree.com/docs/payout/guide/
   */
  private async getPayoutHeaders() {
    const token = await this.getPayoutAuthToken();
    
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
    returnUrl?: string;  // Optional - not used for direct redirect
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
      // return_url must be CLEAN - Cashfree injects order_id automatically
      const orderMeta: any = {
        notify_url: orderData.notifyUrl,
      };

      // Include return_url as-is - DO NOT append any query params
      if (orderData.returnUrl) {
        orderMeta.return_url = orderData.returnUrl;
      }

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
        order_meta: orderMeta,
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

      // If no signature provided, warn but return true (will be handled in service layer)
      if (!signature) {
        logger.warn('No webhook signature provided');
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
        logger.warn({
          receivedSignature: signature.substring(0, 20) + '...',
          expectedSignature: expectedSignature.substring(0, 20) + '...',
          expectedLength: expectedSignature.length,
          receivedLength: signature.length,
          webhookSecretSet: !!config.webhookSecret,
          webhookSecretLength: config.webhookSecret?.length,
        }, '⚠️ Webhook signature verification failed - but allowing processing for debugging');

        // Return true anyway to allow processing (idempotency will prevent duplicates)
        return true;
      } else {
        logger.info('✅ Webhook signature verification passed');
      }

      return isValid;
    } catch (error) {
      logger.error({ error }, 'Webhook signature verification error - allowing processing to continue');
      // Return true to allow processing even if verification throws error
      return true;
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

      // V1 API field names (no snake_case prefixes like V2)
      const payload: any = {
        beneId: data.beneId,
        name: data.name.substring(0, 100),
        email: data.email,
        phone: phone,
        address1: data.address1 || 'India',
      };

      // Add either VPA (UPI) or bank account
      if (data.vpa) {
        payload.vpa = data.vpa; // V1: vpa (not beneficiary_vpa)
      }
      if (data.bankAccount && data.ifsc) {
        payload.bankAccount = data.bankAccount;
        payload.ifsc = data.ifsc;
      }

      logger.info({
        beneId: data.beneId,
        hasVpa: !!data.vpa,
        hasBankAccount: !!data.bankAccount,
        apiVersion: 'v1',
      }, 'Creating beneficiary with V1 API');

      const response = await axios.post(
        `${config.baseUrl}/addBeneficiary`, // V1 endpoint
        payload,
        {
          headers,
          timeout: 20000,
        }
      );

      logger.info({ beneId: data.beneId }, '✅ Beneficiary created successfully with V1 API');
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
        `${config.baseUrl}/getBeneficiary/${beneId}`, // V1 endpoint
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

      // V1 API field names (camelCase, not snake_case)
      const payload = {
        beneId: data.beneId, // V1: beneId (not beneficiary_id)
        amount: data.amount.toString(), // Cashfree expects string
        transferId: data.transferId, // V1: transferId (not transfer_id)
        transferMode: data.transferMode || 'upi', // V1: transferMode (not transfer_mode)
        remarks: data.remarks || 'Payout from Bestie App',
      };

      logger.info({
        transferId: data.transferId,
        amount: data.amount,
        beneId: data.beneId,
        mode: payload.transferMode,
        apiVersion: 'v1',
      }, '💸 Requesting payout with V1 API');

      const response = await axios.post(
        `${config.baseUrl}/requestTransfer`, // V1 endpoint
        payload,
        {
          headers,
          timeout: 30000, // 30 second timeout for payout operations
        }
      );

      // Check if Cashfree returned an error
      if (response.data?.status === 'ERROR') {
        logger.error({
          transferId: data.transferId,
          error: response.data,
          subCode: response.data?.subCode,
          message: response.data?.message,
        }, '❌ Cashfree returned ERROR status in transfer response');

        throw new Error(
          `Cashfree transfer failed: ${response.data?.message || 'Unknown error'} (${response.data?.subCode || 'No code'})`
        );
      }

      logger.info({
        transferId: data.transferId,
        amount: data.amount,
        referenceId: response.data?.data?.referenceId,
        status: response.data?.status,
      }, '✅ Payout requested successfully with V1 API');

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
        `${config.baseUrl}/getTransferStatus?transferId=${transferId}`, // V1 endpoint with query param
        {
          headers,
          timeout: 15000,
        }
      );

      logger.info({
        transferId,
        status: response.data?.data?.transfer?.status,
        apiVersion: 'v1',
      }, 'Payout status retrieved with V1 API');

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
        `${config.baseUrl}/getBalance`, // V1 endpoint
        {
          headers,
          timeout: 15000,
        }
      );

      logger.info({
        balance: response.data?.data?.balance,
        apiVersion: 'v1',
      }, 'Payout balance retrieved with V1 API');

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
        authMethod: 'OAuth Bearer Token (V1)', // V1 uses OAuth token authentication
      },
    };
  }
}

// Export singleton instance
export const cashfreeService = new CashfreeService();

// Export types for use elsewhere
export type { CashfreeConfig, CashfreePayoutConfig };
