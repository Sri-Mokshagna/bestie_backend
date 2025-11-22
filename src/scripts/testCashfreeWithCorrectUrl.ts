import 'dotenv/config';
import { cashfreeService } from '../lib/cashfree';
import { logger } from '../lib/logger';

async function testCashfreeWithCorrectUrl() {
  logger.info('🧪 Testing Cashfree with Corrected URL Configuration...');
  
  try {
    // Override CLIENT_URL for this test
    const originalClientUrl = process.env.CLIENT_URL;
    process.env.CLIENT_URL = 'http://localhost:3000';
    
    logger.info('🔧 Using corrected CLIENT_URL for test: http://localhost:3000');
    
    // Create a test payment session
    const testOrderData = {
      orderId: `TEST_${Date.now()}`,
      amount: 10, // ₹10 test amount
      currency: 'INR',
      customerDetails: {
        customerId: 'test_user_123',
        customerName: 'Test User',
        customerEmail: 'test@example.com',
        customerPhone: '+919999999999'
      },
      orderMeta: {
        returnUrl: `${process.env.CLIENT_URL}/payment/success`,
        notifyUrl: `${process.env.SERVER_URL}/api/payments/webhook`,
        paymentMethods: 'cc,dc,upi,nb,wallet'
      }
    };
    
    logger.info('📡 Testing Cashfree API with corrected configuration...');
    const paymentSession = await cashfreeService.createPaymentSession(testOrderData);
    
    logger.info({ 
      orderId: testOrderData.orderId,
      sessionId: paymentSession.cf_order_id || paymentSession.order_id,
      paymentUrl: paymentSession.payment_link,
      returnUrl: testOrderData.orderMeta.returnUrl
    }, '✅ Cashfree API connection successful with corrected URL!');
    
    // Test payment status check
    logger.info('🔍 Testing payment status check...');
    const statusResponse = await cashfreeService.getPaymentStatus(testOrderData.orderId);
    
    logger.info({ 
      status: statusResponse.order_status,
      orderId: testOrderData.orderId 
    }, '✅ Payment status check successful!');
    
    // Restore original CLIENT_URL
    process.env.CLIENT_URL = originalClientUrl;
    
    logger.info('🎉 All tests passed! The issue was the CLIENT_URL configuration.');
    logger.info('💡 To fix permanently, update your .env file:');
    logger.info('   CLIENT_URL=http://localhost:3000');
    
    return true;
    
  } catch (error: any) {
    logger.error({ 
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    }, '❌ Test failed even with corrected URL');
    
    if (error.response?.status === 401) {
      logger.error('🔑 Authentication failed - Your Cashfree credentials may be invalid');
      logger.info('💡 Check your Cashfree dashboard for correct APP_ID and SECRET_KEY');
    } else if (error.response?.status === 403) {
      logger.error('🚫 Access forbidden - Check if your Cashfree account has the required permissions');
      logger.info('💡 Ensure your Cashfree account is activated and has payment gateway access');
    }
    
    return false;
  }
}

if (require.main === module) {
  testCashfreeWithCorrectUrl()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      logger.error({ error }, 'Test script failed');
      process.exit(1);
    });
}

export { testCashfreeWithCorrectUrl };
