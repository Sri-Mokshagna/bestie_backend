import 'dotenv/config';
import { cashfreeService } from '../lib/cashfree';

async function main() {
  console.log('🧪 Testing Cashfree Payment Link Creation...\n');

  const testOrderId = `TEST_ORDER_${Date.now()}`;

  try {
    console.log('📝 Creating payment order and link...');

    const result = await cashfreeService.createOrderAndGetLink({
      orderId: testOrderId,
      amount: 10,
      currency: 'INR',
      customerDetails: {
        customerId: 'test123',
        customerName: 'Test User',
        customerEmail: 'test@test.com',
        customerPhone: '+919999999999',
      },
      returnUrl: `${process.env.SERVER_URL}/payment/success`,
      notifyUrl: `${process.env.SERVER_URL}/api/payments/webhook`,
    });

    console.log('\n✅ Order created successfully!');
    console.log('Payment Link:', result.payment_link);
    console.log('Link ID:', result.link_id);
    console.log('Order ID:', result.order.order_id);

    console.log('\n🎉 Test completed successfully!');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Test failed:');
    console.error('Error:', error.message);
    if (error.response?.data) {
      console.error('API Response:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

main();
