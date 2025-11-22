import 'dotenv/config';
import { logger } from '../lib/logger';

function checkCashfreeConfiguration() {
  logger.info('🔍 Checking Cashfree Configuration...');
  
  const config = {
    CASHFREE_APP_ID: process.env.CASHFREE_APP_ID,
    CASHFREE_SECRET_KEY: process.env.CASHFREE_SECRET_KEY,
    CASHFREE_WEBHOOK_SECRET: process.env.CASHFREE_WEBHOOK_SECRET,
    CLIENT_URL: process.env.CLIENT_URL,
    SERVER_URL: process.env.SERVER_URL,
    NODE_ENV: process.env.NODE_ENV
  };
  
  // Check for missing variables
  const missingVars = Object.entries(config)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  
  if (missingVars.length > 0) {
    logger.error({ missingVars }, '❌ Missing required environment variables');
    logger.info('💡 Please check your .env file and ensure these variables are set:');
    missingVars.forEach(varName => {
      logger.info(`   ${varName}=your-value-here`);
    });
    return false;
  }
  
  // Log configuration (with masked sensitive data)
  logger.info({
    CASHFREE_APP_ID: config.CASHFREE_APP_ID?.substring(0, 10) + '...',
    CASHFREE_SECRET_KEY: config.CASHFREE_SECRET_KEY ? '***configured***' : 'missing',
    CASHFREE_WEBHOOK_SECRET: config.CASHFREE_WEBHOOK_SECRET ? '***configured***' : 'missing',
    CLIENT_URL: config.CLIENT_URL,
    SERVER_URL: config.SERVER_URL,
    NODE_ENV: config.NODE_ENV
  }, '📋 Current Cashfree configuration');
  
  // Validate URLs
  const urlIssues = [];
  
  if (config.CLIENT_URL && !config.CLIENT_URL.startsWith('http')) {
    urlIssues.push('CLIENT_URL should start with http:// or https://');
  }
  
  if (config.SERVER_URL && !config.SERVER_URL.startsWith('http')) {
    urlIssues.push('SERVER_URL should start with http:// or https://');
  }
  
  if (urlIssues.length > 0) {
    logger.warn({ urlIssues }, '⚠️ URL configuration issues detected');
  }
  
  // Check Cashfree credentials format
  const credentialIssues = [];
  
  if (config.CASHFREE_APP_ID && !config.CASHFREE_APP_ID.startsWith('TEST')) {
    logger.info('📝 Using production Cashfree credentials');
  } else if (config.CASHFREE_APP_ID && config.CASHFREE_APP_ID.startsWith('TEST')) {
    logger.info('🧪 Using test/sandbox Cashfree credentials');
  }
  
  // Determine API endpoint
  const isProduction = config.NODE_ENV === 'production';
  const apiEndpoint = isProduction 
    ? 'https://api.cashfree.com/pg' 
    : 'https://sandbox.cashfree.com/pg';
    
  logger.info({ 
    environment: config.NODE_ENV,
    apiEndpoint,
    isProduction 
  }, '🌐 API endpoint configuration');
  
  // Check webhook URL
  const webhookUrl = `${config.SERVER_URL}/api/payments/webhook`;
  logger.info({ webhookUrl }, '📡 Webhook URL that should be configured in Cashfree dashboard');
  
  if (urlIssues.length === 0 && credentialIssues.length === 0) {
    logger.info('✅ Cashfree configuration looks good!');
    logger.info('💡 Next steps:');
    logger.info('   1. Ensure your Cashfree credentials are valid');
    logger.info('   2. Configure the webhook URL in your Cashfree dashboard');
    logger.info('   3. Test the API connection with: npm run test:cashfree');
    return true;
  } else {
    logger.error('❌ Configuration issues detected. Please fix the above issues.');
    return false;
  }
}

if (require.main === module) {
  const isValid = checkCashfreeConfiguration();
  process.exit(isValid ? 0 : 1);
}

export { checkCashfreeConfiguration };
