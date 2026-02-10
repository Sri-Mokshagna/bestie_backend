// Script to update existing commission configs with new audio/video rate fields
// Run from server directory: npx tsx src/scripts/update-commission-config.ts

import mongoose from 'mongoose';
import { CommissionConfig } from '../models/CommissionConfig';
import { logger } from '../lib/logger';
import 'dotenv/config';

async function updateCommissionConfigs() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        logger.info('Connected to MongoDB');

        // Find all commission configs
        const configs = await CommissionConfig.find({});
        logger.info(`Found ${configs.length} commission configs`);

        for (const config of configs) {
            let updated = false;

            // Add audioCallCoinToInrRate if missing
            if (!config.audioCallCoinToInrRate) {
                config.audioCallCoinToInrRate = config.coinToINRRate || 0.10;
                updated = true;
                logger.info(`Added audioCallCoinToInrRate: ${config.audioCallCoinToInrRate}`);
            }

            // Add videoCallCoinToInrRate if missing
            if (!config.videoCallCoinToInrRate) {
                config.videoCallCoinToInrRate = config.coinToINRRate || 0.15;
                updated = true;
                logger.info(`Added videoCallCoinToInrRate: ${config.videoCallCoinToInrRate}`);
            }

            if (updated) {
                await config.save();
                logger.info(`✅ Updated config ${config._id}`);
            } else {
                logger.info(`ℹ️  Config ${config._id} already has all fields`);
            }
        }

        logger.info('✅ Commission configs migration completed successfully');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Error updating commission configs:', error);
        process.exit(1);
    }
}

updateCommissionConfigs();
