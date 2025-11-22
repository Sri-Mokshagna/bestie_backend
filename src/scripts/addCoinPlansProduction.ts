import 'dotenv/config';
import { CoinPlan, PlanTag } from '../models/CoinPlan';
import { CommissionConfig } from '../models/CommissionConfig';
import { connectDB } from '../lib/db';
import { logger } from '../lib/logger';

const coinPlans = [
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
    discount: 20, // 20% discount
    isActive: true,
  },
  {
    name: 'Value Pack',
    priceINR: 100,
    coins: 1300,
    tags: [PlanTag.UNLIMITED],
    discount: 30, // 30% discount
    isActive: true,
  },
  {
    name: 'Premium Pack',
    priceINR: 200,
    coins: 2800,
    tags: [PlanTag.UNLIMITED],
    discount: 40, // 40% discount
    isActive: true,
  },
  {
    name: 'Ultimate Pack',
    priceINR: 500,
    coins: 7500,
    tags: [PlanTag.UNLIMITED],
    discount: 50, // 50% discount
    isActive: true,
  },
];

const commissionConfig = {
  responderCommissionPercentage: 50,
  adminCommissionPercentage: 50,
  coinToINRRate: 0.1, // 1 coin = 0.1 INR for redemption
  minimumRedemptionCoins: 100,
  isActive: true,
};

async function addCoinPlansToProduction() {
  try {
    logger.info('🚀 Adding coin plans to production database...');
    
    await connectDB();
    
    // Check if plans already exist
    const existingPlans = await CoinPlan.countDocuments();
    logger.info({ existingPlans }, 'Current coin plans count');
    
    if (existingPlans > 0) {
      logger.info('📋 Coin plans already exist. Updating existing plans...');
      
      // Delete existing plans and add new ones
      await CoinPlan.deleteMany({});
      logger.info('🗑️ Removed existing coin plans');
    }
    
    // Add new coin plans
    const createdPlans = await CoinPlan.insertMany(coinPlans);
    logger.info({ count: createdPlans.length }, '✅ Coin plans added successfully');
    
    // Log created plans
    createdPlans.forEach(plan => {
      logger.info({
        name: plan.name,
        price: plan.priceINR,
        coins: plan.coins,
        discount: plan.discount
      }, '💰 Plan created');
    });
    
    // Check commission config
    const existingConfig = await CommissionConfig.countDocuments();
    if (existingConfig === 0) {
      await CommissionConfig.create(commissionConfig);
      logger.info('⚙️ Commission config created');
    } else {
      logger.info('⚙️ Commission config already exists');
    }
    
    // Verify plans are accessible
    const activePlans = await CoinPlan.find({ isActive: true }).sort({ priceINR: 1 });
    logger.info({ count: activePlans.length }, '🔍 Active plans verification');
    
    logger.info('🎉 Coin plans setup completed successfully!');
    logger.info('💡 Users should now be able to see coin plans in the app');
    
    process.exit(0);
    
  } catch (error) {
    logger.error({ error }, '❌ Failed to add coin plans');
    process.exit(1);
  }
}

if (require.main === module) {
  addCoinPlansToProduction();
}

export { addCoinPlansToProduction };
