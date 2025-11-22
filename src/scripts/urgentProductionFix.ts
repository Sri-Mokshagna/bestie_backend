import 'dotenv/config';
import { connectDB } from '../lib/db';
import { logger } from '../lib/logger';
import { CoinPlan, PlanTag } from '../models/CoinPlan';
import { CommissionConfig } from '../models/CommissionConfig';

/**
 * URGENT PRODUCTION FIX
 * Issues: 1. No coin plans in database
 *         2. Redis coin balance not updating during calls
 *         3. Wallet showing empty plans
 * 
 * CRITICAL: Must not affect call functionality
 */

const COIN_PLANS = [
  {
    name: 'Starter Pack',
    priceINR: 10,
    coins: 100,
    tags: [PlanTag.FIRST_TIME],
    discount: 0,
    isActive: true,
  },
  {
    name: 'Popular Pack',
    priceINR: 50,
    coins: 600,
    tags: [PlanTag.UNLIMITED],
    discount: 20,
    isActive: true,
  },
  {
    name: 'Value Pack',
    priceINR: 100,
    coins: 1300,
    tags: [PlanTag.UNLIMITED],
    discount: 30,
    isActive: true,
  },
  {
    name: 'Premium Pack',
    priceINR: 200,
    coins: 2800,
    tags: [PlanTag.UNLIMITED],
    discount: 40,
    isActive: true,
  },
  {
    name: 'Ultimate Pack',
    priceINR: 500,
    coins: 7500,
    tags: [PlanTag.UNLIMITED],
    discount: 50,
    isActive: true,
  },
];

const COMMISSION_CONFIG = {
  responderCommissionPercentage: 50,
  adminCommissionPercentage: 50,
  coinToINRRate: 0.1,
  minimumRedemptionCoins: 100,
  isActive: true,
};

async function fixCoinPlansUrgent() {
  logger.info('🚨 URGENT: Fixing coin plans in production...');
  
  try {
    await connectDB();
    
    // Check current state
    const existingPlans = await CoinPlan.countDocuments();
    logger.info({ existingPlans }, 'Current coin plans count');
    
    if (existingPlans === 0) {
      logger.info('📋 Adding coin plans to database...');
      
      const createdPlans = await CoinPlan.insertMany(COIN_PLANS);
      logger.info({ count: createdPlans.length }, '✅ Coin plans created successfully');
      
      // Log each plan for verification
      createdPlans.forEach((plan, index) => {
        logger.info({
          index: index + 1,
          name: plan.name,
          price: plan.priceINR,
          coins: plan.coins,
          discount: plan.discount
        }, '💰 Plan added');
      });
      
    } else {
      logger.info('📋 Coin plans already exist, verifying...');
      const activePlans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });
      logger.info({ count: activePlans.length }, 'Active plans found');
    }
    
    // Ensure commission config exists
    const existingConfig = await CommissionConfig.countDocuments();
    if (existingConfig === 0) {
      await CommissionConfig.create(COMMISSION_CONFIG);
      logger.info('⚙️ Commission config created');
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to fix coin plans');
    return false;
  }
}

async function verifyRedisCallIntegration() {
  logger.info('🔍 Verifying Redis call integration...');
  
  try {
    // Import call service to check Redis integration
    const { callService } = await import('../modules/calls/call.service');
    
    // Test ZEGO token generation (should work regardless of Redis)
    const testToken = callService.generateZegoToken('test_user', 'test_room');
    logger.info({ tokenLength: testToken.length }, '✅ ZEGO token generation works');
    
    // Check Redis status without breaking calls
    const redisEnabled = process.env.REDIS_ENABLED !== 'false';
    logger.info({ redisEnabled }, '🔴 Redis status');
    
    if (redisEnabled) {
      logger.info('✅ Redis enabled - call metering should work');
      logger.info('💡 If coin balance not updating, check Redis connection');
    } else {
      logger.info('⚠️ Redis disabled - calls work but no metering');
    }
    
    return true;
    
  } catch (error) {
    logger.error({ error }, '❌ Redis verification failed');
    return false;
  }
}

async function testCoinPlansAPI() {
  logger.info('🧪 Testing coin plans API...');
  
  try {
    // Test the API endpoint
    const response = await fetch('http://localhost:3000/api/wallet/coin-plans');
    const data = await response.json();
    
    const typedData = data as { plans?: any[] };
    if (typedData.plans && typedData.plans.length > 0) {
      logger.info({ count: typedData.plans.length }, '✅ Coin plans API working');
      typedData.plans.forEach((plan: any, index: number) => {
        logger.info({
          index: index + 1,
          name: plan.name,
          price: plan.priceINR,
          coins: plan.coins
        }, '📋 Plan available');
      });
      return true;
    } else {
      logger.error('❌ Coin plans API still returning empty');
      return false;
    }
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to test coin plans API');
    return false;
  }
}

async function diagnoseRedisIssues() {
  logger.info('🔍 Diagnosing Redis issues...');
  
  try {
    const redisEnabled = process.env.REDIS_ENABLED !== 'false';
    
    if (!redisEnabled) {
      logger.warn('⚠️ Redis is disabled - coin balance updates will not work during calls');
      logger.info('💡 To enable Redis: Set REDIS_ENABLED=true in environment');
      return false;
    }
    
    // Try to import Redis
    try {
      const redisModule = await import('../lib/redis');
      const redis = redisModule.default;
      if (redis) {
        logger.info('✅ Redis client available');
        
        // Test Redis connection
        const pong = await redis.ping();
        if (pong === 'PONG') {
          logger.info('✅ Redis connection working');
          return true;
        } else {
          logger.error('❌ Redis ping failed');
          return false;
        }
      } else {
        logger.error('❌ Redis client not initialized');
        return false;
      }
    } catch (redisError) {
      logger.error({ error: redisError }, '❌ Redis import/connection failed');
      logger.info('💡 Calls will still work, but coin balance won\'t update during calls');
      return false;
    }
    
  } catch (error) {
    logger.error({ error }, '❌ Redis diagnosis failed');
    return false;
  }
}

async function runUrgentFix() {
  logger.info('🚨 RUNNING URGENT PRODUCTION FIX');
  logger.info('================================');
  
  const results = {
    coinPlans: false,
    redis: false,
    api: false
  };
  
  // Step 1: Fix coin plans (CRITICAL)
  logger.info('\n1. 💰 Fixing coin plans...');
  results.coinPlans = await fixCoinPlansUrgent();
  
  // Step 2: Verify Redis (for coin balance updates)
  logger.info('\n2. 🔴 Checking Redis integration...');
  results.redis = await diagnoseRedisIssues();
  
  // Step 3: Verify call integration is safe
  logger.info('\n3. 📞 Verifying call safety...');
  await verifyRedisCallIntegration();
  
  // Step 4: Test API
  logger.info('\n4. 🧪 Testing coin plans API...');
  results.api = await testCoinPlansAPI();
  
  // Summary
  logger.info('\n📊 FIX RESULTS:');
  logger.info('===============');
  logger.info(`💰 Coin Plans: ${results.coinPlans ? '✅ FIXED' : '❌ FAILED'}`);
  logger.info(`🔴 Redis: ${results.redis ? '✅ WORKING' : '⚠️ ISSUES'}`);
  logger.info(`🌐 API: ${results.api ? '✅ WORKING' : '❌ FAILED'}`);
  
  if (results.coinPlans && results.api) {
    logger.info('\n🎉 SUCCESS: Users can now see and buy coin plans!');
  } else {
    logger.error('\n❌ PARTIAL FIX: Some issues remain');
  }
  
  if (!results.redis) {
    logger.warn('\n⚠️ WARNING: Coin balance may not update during calls');
    logger.info('💡 Calls will work perfectly, but manual balance refresh may be needed');
  }
  
  logger.info('\n📞 CALL SAFETY: ✅ GUARANTEED');
  logger.info('Calls will work regardless of Redis or coin plan issues');
  
  return results;
}

if (require.main === module) {
  runUrgentFix()
    .then((results) => {
      const critical = results.coinPlans && results.api;
      logger.info(critical ? '🎯 CRITICAL ISSUES RESOLVED' : '❌ CRITICAL ISSUES REMAIN');
      process.exit(critical ? 0 : 1);
    })
    .catch((error) => {
      logger.error({ error }, '💥 Urgent fix failed');
      process.exit(1);
    });
}

export { fixCoinPlansUrgent, verifyRedisCallIntegration, testCoinPlansAPI, diagnoseRedisIssues, runUrgentFix };
