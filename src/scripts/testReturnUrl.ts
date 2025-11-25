import { logger } from '../lib/logger';

/**
 * Test the return URL building logic
 */
function buildReturnUrl(clientUrl: string, orderId: string): string {
  // Handle different CLIENT_URL formats:
  // 1. "bestie://" -> "bestie://payment/success?orderId=XXX"
  // 2. "bestie://payment" -> "bestie://payment/success?orderId=XXX" 
  // 3. "http://localhost:3000" -> "http://localhost:3000/payment/success?orderId=XXX"
  
  let baseUrl = clientUrl;
  
  // If CLIENT_URL ends with "payment", don't add it again
  if (baseUrl.endsWith('payment')) {
    return `${baseUrl}/success?orderId=${orderId}`;
  }
  
  // If CLIENT_URL ends with "/", don't add extra slash
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}payment/success?orderId=${orderId}`;
  }
  
  // Default case: add /payment/success
  return `${baseUrl}/payment/success?orderId=${orderId}`;
}

function testReturnUrlBuilding() {
  logger.info('🧪 Testing Return URL Building Logic...');
  
  const testCases = [
    {
      clientUrl: 'bestie://payment',
      orderId: 'ORDER_123',
      expected: 'bestie://payment/success?orderId=ORDER_123'
    },
    {
      clientUrl: 'bestie://',
      orderId: 'ORDER_456',
      expected: 'bestie://payment/success?orderId=ORDER_456'
    },
    {
      clientUrl: 'http://localhost:3000',
      orderId: 'ORDER_789',
      expected: 'http://localhost:3000/payment/success?orderId=ORDER_789'
    },
    {
      clientUrl: 'https://myapp.com/',
      orderId: 'ORDER_ABC',
      expected: 'https://myapp.com/payment/success?orderId=ORDER_ABC'
    }
  ];
  
  let allPassed = true;
  
  testCases.forEach((testCase, index) => {
    const result = buildReturnUrl(testCase.clientUrl, testCase.orderId);
    const passed = result === testCase.expected;
    
    logger.info(`Test ${index + 1}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    logger.info(`  Input: "${testCase.clientUrl}" + "${testCase.orderId}"`);
    logger.info(`  Expected: "${testCase.expected}"`);
    logger.info(`  Got:      "${result}"`);
    
    if (!passed) {
      allPassed = false;
    }
  });
  
  logger.info(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  // Test with current production setup
  logger.info('\n🚀 Production Test:');
  const productionUrl = buildReturnUrl('bestie://payment', 'ORDER_1764087876042_d65cbb32');
  logger.info(`Production URL: ${productionUrl}`);
  logger.info('This should fix the "bestie://paymentpayment/success" issue!');
  
  return allPassed;
}

if (require.main === module) {
  testReturnUrlBuilding();
}
