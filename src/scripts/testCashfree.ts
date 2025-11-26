import 'dotenv/config';
import { cashfreeService } from '../lib/cashfree';
import { logger } from '../lib/logger';

async function testCashfreeConnection() {
  logger.info('🔍 Testing Cashfree Configuration...');

  // Check environment variables
  const requiredEnvVars = [
    'CASHFREE_APP_ID',
    'CASHFREE_SECRET_KEY',
    'CASHFREE_WEBHOOK_SECRET',
    'CLIENT_URL',
    'SERVER_URL'
  ];

  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    logger.error({ missingVars }, '❌ Missing required environment variables');
    return false;
  }

  // Log environment variable values (masked for security)
  logger.info({
    CASHFREE_APP_ID: process.env.CASHFREE_APP_ID?.substring(0, 10) + '...',
    CLIENT_URL: process.env.CLIENT_URL,
    SERVER_URL: process.env.SERVER_URL,
    NODE_ENV: process.env.NODE_ENV
  }, '📋 Current environment configuration');

  logger.info('✅ All required environment variables are present');

  // Test configuration initialization
  try {
    logger.info('🔧 Testing Cashfree service initialization...');

    // Create a test payment session to verify API connectivity
    const testOrderData = {
      orderId: `TEST_${Date.now()}`,
      amount: 10,
      currency: 'INR',
      customerDetails: {
        customerId: 'test_user_123',
        customerName: 'Test User',
        customerEmail: 'test@example.com',
        customerPhone: '+919999999999'
      },
      returnUrl: `${process.env.SERVER_URL}/payment/success`,
      notifyUrl: `${process.env.SERVER_URL}/api/payments/webhook`,
    };

    logger.info('📡 Testing API connection with Cashfree...');
    const result = await cashfreeService.createOrderAndGetLink(testOrderData);

    logger.info({
      orderId: testOrderData.orderId,
      paymentLink: result.payment_link,
      linkId: result.link_id
    }, '✅ Cashfree API connection successful!');

    // Test payment status check
    logger.info('🔍 Testing payment status check...');
    const statusResponse = await cashfreeService.getPaymentStatus(testOrderData.orderId);

    logger.info({
      status: statusResponse.order_status,
      orderId: testOrderData.orderId
    }, '✅ Payment status check successful!');

    return true;

  } catch (error: any) {
    logger.error({
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    }, '❌ Cashfree API connection failed');

    // Provide specific error guidance
    if (error.response?.status === 401) {
      logger.error('🔑 Authentication failed - Check your CASHFREE_APP_ID and CASHFREE_SECRET_KEY');
    } else if (error.response?.status === 400) {
      logger.error('📝 Bad request - Check the API payload format');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      logger.error('🌐 Network connection failed - Check internet connectivity');
    }

    return false;
  }
}

async function testWebhookConfiguration() {
  logger.info('🔍 Testing Webhook Configuration...');

  try {
    // Test webhook signature verification
    const testPayload = JSON.stringify({
      order_id: 'TEST_ORDER_123',
      payment_status: 'SUCCESS',
      cf_payment_id: 'TEST_PAYMENT_123'
    });

    const testSignature = 'test_signature';

    // This will test if the webhook secret is properly configured
    const isValid = cashfreeService.verifyWebhookSignature(testPayload, testSignature);

    logger.info({ isValid }, '✅ Webhook signature verification function is working');

    // Check webhook URL configuration
    const webhookUrl = `${process.env.SERVER_URL}/api/payments/webhook`;
    logger.info({ webhookUrl }, '📡 Webhook URL configured');

    return true;

  } catch (error: any) {
    logger.error({ error: error.message }, '❌ Webhook configuration test failed');
    return false;
  }
}

async function main() {
  logger.info('🚀 Starting Cashfree Configuration Test...');

  const apiTest = await testCashfreeConnection();
  const webhookTest = await testWebhookConfiguration();

  if (apiTest && webhookTest) {
    logger.info('🎉 All Cashfree tests passed! Configuration is correct.');
  } else {
    logger.error('❌ Some tests failed. Please check the configuration.');
  }

  process.exit(apiTest && webhookTest ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    logger.error({ error }, 'Test script failed');
    process.exit(1);
  });
}

export { testCashfreeConnection, testWebhookConfiguration };
