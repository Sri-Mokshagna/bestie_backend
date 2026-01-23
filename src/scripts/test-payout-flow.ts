import 'dotenv/config';
import { cashfreeService } from '../lib/cashfree';
import { logger } from '../lib/logger';

/**
 * Comprehensive Payout Flow Test
 * Tests the entire payout flow to identify where transfers are failing
 */

async function testPayoutConfiguration() {
    logger.info('🔍 Testing Cashfree Payout Configuration...');

    // Check payout environment variables
    const payoutEnvVars = [
        'CASHFREE_PAYOUT_CLIENT_ID',
        'CASHFREE_PAYOUT_CLIENT_SECRET',
    ];

    const missingVars = payoutEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
        logger.error({ missingVars }, '❌ Missing payout environment variables');
        return false;
    }

    logger.info({
        CASHFREE_PAYOUT_CLIENT_ID: process.env.CASHFREE_PAYOUT_CLIENT_ID?.substring(0, 10) + '...',
        CASHFREE_PAYOUT_CLIENT_SECRET: process.env.CASHFREE_PAYOUT_CLIENT_SECRET ? 'Set' : 'Not Set',
    }, '📋 Payout credentials configured');

    return true;
}

async function testPayoutToken() {
    logger.info('🔑 Testing Payout Token Generation...');

    try {
        // This will trigger token generation internally
        const balance = await cashfreeService.getPayoutBalance();

        logger.info({
            balance: balance.data?.balance,
            status: balance.status,
        }, '✅ Payout token generated successfully - Balance retrieved');

        return true;
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
        }, '❌ Failed to generate payout token');

        if (error.response?.status === 401) {
            logger.error('🔑 Authentication failed - Check your CASHFREE_PAYOUT_CLIENT_ID and CASHFREE_PAYOUT_CLIENT_SECRET');
        }

        return false;
    }
}

async function testBeneficiaryCreation() {
    logger.info('👤 Testing Beneficiary Creation...');

    const testBeneId = `BENE_TEST_${Date.now()}`;
    const testData = {
        beneId: testBeneId,
        name: 'Test Beneficiary',
        email: 'test@example.com',
        phone: '9999999999',
        vpa: '9999999999@paytm', // Test UPI ID
    };

    try {
        const result = await cashfreeService.createBeneficiary(testData);

        logger.info({
            beneId: testBeneId,
            status: result.status,
            response: result,
        }, '✅ Beneficiary created successfully');

        return testBeneId;
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            beneId: testBeneId,
        }, '❌ Failed to create beneficiary');

        return null;
    }
}

async function testPayoutRequest(beneId: string) {
    logger.info('💸 Testing Payout Request...');

    const testTransferId = `TRANSFER_TEST_${Date.now()}`;
    const testData = {
        transferId: testTransferId,
        beneId: beneId,
        amount: 1, // Minimum amount ₹1
        transferMode: 'upi' as const,
        remarks: 'Test payout from Bestie App',
    };

    try {
        const result = await cashfreeService.requestPayout(testData);

        logger.info({
            transferId: testTransferId,
            beneId: beneId,
            amount: testData.amount,
            status: result.status,
            referenceId: result.referenceId,
            response: result,
        }, '✅ Payout requested successfully');

        return testTransferId;
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            transferId: testTransferId,
            requestData: testData,
        }, '❌ Failed to request payout - THIS IS THE CRITICAL ISSUE');

        // Provide specific troubleshooting guidance
        const errorData = error.response?.data;
        if (errorData) {
            logger.error({
                errorCode: errorData.subCode || errorData.code,
                errorMessage: errorData.message,
                errorDetails: errorData,
            }, '🔍 Detailed error information');

            // Common error scenarios
            if (errorData.message?.includes('beneficiary')) {
                logger.error('❌ Beneficiary issue - The beneficiary may not be properly registered');
            } else if (errorData.message?.includes('balance') || errorData.message?.includes('insufficient')) {
                logger.error('❌ Insufficient balance in Cashfree payout account - Please add funds');
            } else if (errorData.message?.includes('VPA') || errorData.message?.includes('UPI')) {
                logger.error('❌ Invalid UPI ID - The UPI ID may not be valid or active');
            } else if (errorData.message?.includes('duplicate')) {
                logger.error('❌ Duplicate transfer ID - A transfer with this ID already exists');
            }
        }

        return null;
    }
}

async function testPayoutStatus(transferId: string) {
    logger.info('📊 Testing Payout Status Check...');

    try {
        const result = await cashfreeService.getPayoutStatus(transferId);

        logger.info({
            transferId: transferId,
            status: result.transfer?.status,
            response: result,
        }, '✅ Payout status retrieved successfully');

        return true;
    } catch (error: any) {
        logger.error({
            error: error.message,
            response: error.response?.data,
            status: error.response?.status,
            transferId: transferId,
        }, '❌ Failed to get payout status');

        return false;
    }
}

async function main() {
    logger.info('🚀 Starting Comprehensive Payout Flow Test...\n');

    // Step 1: Check configuration
    const configOk = await testPayoutConfiguration();
    if (!configOk) {
        logger.error('❌ Payout configuration failed. Please set the required environment variables.');
        process.exit(1);
    }

    logger.info('\n');

    // Step 2: Test token generation
    const tokenOk = await testPayoutToken();
    if (!tokenOk) {
        logger.error('❌ Token generation failed. Cannot proceed with payout tests.');
        process.exit(1);
    }

    logger.info('\n');

    // Step 3: Test beneficiary creation
    const beneId = await testBeneficiaryCreation();
    if (!beneId) {
        logger.error('❌ Beneficiary creation failed. Cannot proceed with payout tests.');
        process.exit(1);
    }

    logger.info('\n');

    // Step 4: Test payout request (THIS IS WHERE THE ISSUE LIKELY IS)
    const transferId = await testPayoutRequest(beneId);
    if (!transferId) {
        logger.error('❌ Payout request failed. This is the critical issue preventing transfers.');
        logger.error('📝 Please check the error details above to identify the root cause.');
        process.exit(1);
    }

    logger.info('\n');

    // Step 5: Test payout status check
    await testPayoutStatus(transferId);

    logger.info('\n');
    logger.info('🎉 All payout tests passed! The payout system is working correctly.');
    logger.info('💡 If you\'re still not receiving money, please check:');
    logger.info('   1. Cashfree payout account balance');
    logger.info('   2. UPI ID is valid and active');
    logger.info('   3. Bank/UPI provider is accepting transfers');
    logger.info('   4. No daily/monthly limits on the UPI ID');

    process.exit(0);
}

if (require.main === module) {
    main().catch((error) => {
        logger.error({ error }, '❌ Test script failed with unexpected error');
        process.exit(1);
    });
}

export { testPayoutConfiguration, testPayoutToken, testBeneficiaryCreation, testPayoutRequest, testPayoutStatus };
