import 'dotenv/config';
import { logger } from '../lib/logger';
import { connectDB } from '../lib/db';
import { callService } from '../modules/calls/call.service';
import { CallType } from '../models/Call';

async function testCallFlow() {
  logger.info('🧪 Testing Call Flow...');
  
  try {
    await connectDB();
    
    // Test ZEGO token generation
    logger.info('1. Testing ZEGO token generation...');
    try {
      const token = callService.generateZegoToken('test_user_123', 'test_room_456');
      logger.info({ tokenLength: token.length }, '✅ ZEGO token generated successfully');
    } catch (error) {
      logger.error({ error }, '❌ ZEGO token generation failed');
    }
    
    // Test call initiation (requires actual user IDs)
    logger.info('2. Testing call flow states...');
    logger.info('   - RINGING → CONNECTING → ACTIVE → ENDED');
    logger.info('   - This requires actual user IDs from database');
    
    // Test cleanup functionality
    logger.info('3. Testing call cleanup...');
    try {
      const result = await callService.cleanupStaleCalls();
      logger.info(result, '✅ Call cleanup completed');
    } catch (error) {
      logger.error({ error }, '❌ Call cleanup failed');
    }
    
    logger.info('🎉 Call flow test completed');
    
  } catch (error) {
    logger.error({ error }, '❌ Test failed');
  }
}

async function testZegoTokenGeneration() {
  logger.info('🔑 Testing ZEGO Token Generation...');
  
  const testCases = [
    { userId: 'user_123', roomId: 'room_456' },
    { userId: 'responder_789', roomId: 'room_abc' },
  ];
  
  for (const testCase of testCases) {
    try {
      const token = callService.generateZegoToken(testCase.userId, testCase.roomId);
      
      // Basic token validation
      const parts = token.split('.');
      if (parts.length === 3) {
        logger.info({
          userId: testCase.userId,
          roomId: testCase.roomId,
          tokenFormat: 'JWT',
          parts: parts.length
        }, '✅ Token generated with correct format');
      } else {
        logger.warn({
          userId: testCase.userId,
          roomId: testCase.roomId,
          tokenFormat: 'Unknown',
          token: token.substring(0, 50) + '...'
        }, '⚠️ Token generated but format unclear');
      }
      
    } catch (error) {
      logger.error({
        error,
        userId: testCase.userId,
        roomId: testCase.roomId
      }, '❌ Token generation failed');
    }
  }
}

async function checkEnvironmentConfiguration() {
  logger.info('🔧 Checking Environment Configuration...');
  
  const requiredVars = [
    'ZEGO_APP_ID',
    'ZEGO_SERVER_SECRET',
    'REDIS_ENABLED',
    'MONGODB_URI'
  ];
  
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    logger.error({ missingVars }, '❌ Missing required environment variables');
    logger.info('💡 Required for call functionality:');
    missingVars.forEach(varName => {
      logger.info(`   ${varName}=your-value-here`);
    });
  } else {
    logger.info('✅ All required environment variables present');
  }
  
  // Check ZEGO configuration
  if (process.env.ZEGO_APP_ID && process.env.ZEGO_SERVER_SECRET) {
    logger.info({
      ZEGO_APP_ID: process.env.ZEGO_APP_ID,
      ZEGO_SERVER_SECRET: process.env.ZEGO_SERVER_SECRET ? '***configured***' : 'missing'
    }, '📱 ZEGO configuration');
  }
  
  // Check Redis configuration
  const redisEnabled = process.env.REDIS_ENABLED !== 'false';
  logger.info({ redisEnabled }, '🔴 Redis configuration');
  
  if (!redisEnabled) {
    logger.warn('⚠️ Redis is disabled - call metering will not work');
  }
}

if (require.main === module) {
  Promise.all([
    checkEnvironmentConfiguration(),
    testZegoTokenGeneration(),
    testCallFlow()
  ]).then(() => {
    logger.info('🏁 All tests completed');
    process.exit(0);
  }).catch((error) => {
    logger.error({ error }, '💥 Test suite failed');
    process.exit(1);
  });
}

export { testCallFlow, testZegoTokenGeneration, checkEnvironmentConfiguration };
