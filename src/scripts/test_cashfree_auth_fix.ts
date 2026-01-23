import 'dotenv/config';
import { cashfreeService } from '../lib/cashfree';
import { logger } from '../lib/logger';

/**
 * Test script to verify Cashfree payout authentication fix
 * This script tests the updated Basic authentication method
 */
async function testCashfreeAuthFix() {
    logger.info('🧪 Testing Cashfree Payout Authentication Fix...');
    
    try {
        // Test 1: Check if credentials are configured
        const clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID;
        const clientSecret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET;
        
        if (!clientId || !clientSecret) {
            logger.error({
                hasClientId: !!clientId,
                hasClientSecret: !!clientSecret,
            }, '❌ Payout credentials not configured in environment variables');
            
            logger.info('💡 Please set CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET in your .env file');
            logger.info('🔗 You can get these from: Cashfree Dashboard > Payouts > API Keys');
            return;
        }
        
        logger.info({
            clientIdPreview: clientId.substring(0, 15) + '...',
            clientSecretSet: !!clientSecret,
        }, '✅ Payout credentials found in environment');

        // Test 2: Test balance API call (which will use the new auth method)
        logger.info('💰 Testing payout balance API call with new Basic authentication...');
        
        const balanceResult = await cashfreeService.getPayoutBalance();
        
        logger.info({
            balance: balanceResult.data?.balance,
            status: balanceResult.status,
        }, '✅ Balance API call successful - Authentication is working!');
        
        logger.info('🎉 Cashfree payout authentication fix verified successfully!');
        logger.info('💡 The "Token is not valid" error should now be resolved');
        
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
        }, '❌ Test failed - Authentication issue still exists');
        
        if (error.response?.status === 401 || error.message.includes('not valid')) {
            logger.error('🔐 The authentication method may still need adjustment');
        }
        
        throw error;
    }
}

if (require.main === module) {
    testCashfreeAuthFix()
        .then(() => {
            logger.info('✅ Test completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            logger.error('❌ Test failed', { error: error.message });
            process.exit(1);
        });
}

export { testCashfreeAuthFix };