import { CoinPlan, PlanTag } from '../models/CoinPlan';
import { CommissionConfig } from '../models/CommissionConfig';
import { connectDB } from '../lib/db';
import { logger } from '../lib/logger';

const defaultPlans = [
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
    priceINR: 20,
    coins: 200,
    tags: [PlanTag.UNLIMITED],
    discount: 0,
    isActive: true,
  },
  {
    name: 'Value Pack',
    priceINR: 50,
    coins: 500,
    tags: [PlanTag.UNLIMITED],
    discount: 0,
    isActive: true,
  },
];

const defaultCommissionConfig = {
  responderCommissionPercentage: 50,
  adminCommissionPercentage: 50,
  coinToINRRate: 0.1, // 1 coin = 0.1 INR for redemption
  minimumRedemptionCoins: 100,
  isActive: true,
};

async function seedCoinPlans() {
  try {
    await connectDB();

    // Check if plans already exist
    const existingPlans = await CoinPlan.countDocuments();
    if (existingPlans > 0) {
      logger.info('Coin plans already exist, skipping seed');
      return;
    }

    // Create default plans
    await CoinPlan.insertMany(defaultPlans);
    logger.info('Default coin plans created');

    // Check if commission config exists
    const existingConfig = await CommissionConfig.countDocuments();
    if (existingConfig === 0) {
      await CommissionConfig.create(defaultCommissionConfig);
      logger.info('Default commission config created');
    }

    logger.info('Coin plans and commission config seeded successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to seed coin plans');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  seedCoinPlans()
    .then(() => {
      logger.info('Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Seeding failed');
      process.exit(1);
    });
}

export default seedCoinPlans;
