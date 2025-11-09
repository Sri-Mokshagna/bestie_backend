/**
 * Initialize Default Coin Configuration
 * Run this script once to set up the initial coin system configuration
 * 
 * Usage: node scripts/init-coin-config.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';

const coinConfigSchema = new mongoose.Schema({
  chatCoinsPerMessage: Number,
  audioCallCoinsPerMinute: Number,
  videoCallCoinsPerMinute: Number,
  initialUserCoins: Number,
  responderMinRedeemCoins: Number,
  responderCommissionPercentage: Number,
  coinsToINRRate: Number,
  chatEnabled: Boolean,
  audioCallEnabled: Boolean,
  videoCallEnabled: Boolean,
  isActive: Boolean,
  createdBy: String,
}, { timestamps: true });

const CoinConfig = mongoose.model('CoinConfig', coinConfigSchema);

async function initializeCoinConfig() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if config already exists
    const existingConfig = await CoinConfig.findOne({ isActive: true });
    
    if (existingConfig) {
      console.log('⚠️  Active coin configuration already exists:');
      console.log(JSON.stringify(existingConfig, null, 2));
      console.log('\nTo update, use the admin API endpoint: PUT /api/admin/coin-config');
      return;
    }

    // Create default configuration
    const defaultConfig = await CoinConfig.create({
      chatCoinsPerMessage: 3,
      audioCallCoinsPerMinute: 10,
      videoCallCoinsPerMinute: 60,
      initialUserCoins: 10,
      responderMinRedeemCoins: 100,
      responderCommissionPercentage: 70,
      coinsToINRRate: 1,
      chatEnabled: true,
      audioCallEnabled: true,
      videoCallEnabled: true,
      isActive: true,
      createdBy: 'system',
    });

    console.log('✅ Default coin configuration created successfully!');
    console.log('\n📋 Configuration:');
    console.log('─────────────────────────────────────────');
    console.log(`Chat: ${defaultConfig.chatCoinsPerMessage} coins per message`);
    console.log(`Audio Call: ${defaultConfig.audioCallCoinsPerMinute} coins per minute`);
    console.log(`Video Call: ${defaultConfig.videoCallCoinsPerMinute} coins per minute`);
    console.log(`Initial User Coins: ${defaultConfig.initialUserCoins} coins`);
    console.log(`Responder Min Redeem: ${defaultConfig.responderMinRedeemCoins} coins`);
    console.log(`Responder Commission: ${defaultConfig.responderCommissionPercentage}%`);
    console.log(`Coins to INR Rate: ${defaultConfig.coinsToINRRate} INR per coin`);
    console.log('─────────────────────────────────────────');
    console.log('\n💡 New users will automatically receive 10 coins on signup');
    console.log('💡 Responders earn 70% of coins spent by users');
    console.log('💡 Responders can redeem after earning 100 coins');
    console.log('\n🔧 To modify these settings, use the admin panel or API');

  } catch (error) {
    console.error('❌ Error initializing coin configuration:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

initializeCoinConfig();
