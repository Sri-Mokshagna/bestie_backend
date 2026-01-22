/**
 * Check current commission configuration
 */

const mongoose = require('mongoose');

// Commission Config Schema
const commissionConfigSchema = new mongoose.Schema({
    responderCommissionPercentage: Number,
    adminCommissionPercentage: Number,
    coinToINRRate: Number,
    minimumRedemptionCoins: Number,
    isActive: Boolean,
}, { timestamps: true });

const CommissionConfig = mongoose.model('CommissionConfig', commissionConfigSchema);

async function checkCommission() {
    try {
        // Read .env file manually
        const fs = require('fs');
        const path = require('path');
        const envPath = path.join(__dirname, '..', '.env');

        let MONGODB_URI = 'mongodb://localhost:27017/bestie';

        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const uriMatch = envContent.match(/MONGODB_URI=(.+)/);
            if (uriMatch) {
                MONGODB_URI = uriMatch[1].trim();
            }
        }

        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const config = await CommissionConfig.findOne({ isActive: true });

        if (!config) {
            console.log('❌ No active commission config found!\n');
        } else {
            console.log('📊 CURRENT COMMISSION CONFIGURATION');
            console.log('═══════════════════════════════════════════════════');
            console.log(`  Responder Gets: ${config.responderCommissionPercentage}%`);
            console.log(`  Platform Gets:  ${config.adminCommissionPercentage}%`);
            console.log(`═══════════════════════════════════════════════════\n`);

            // Test with 2 coins
            const testCoins = 2;
            const responderGets = Math.floor(testCoins * (config.responderCommissionPercentage / 100));
            const adminGets = testCoins - responderGets;

            console.log('💰 TEST: If user pays 2 coins for a call:');
            console.log(`  → Responder receives: ${responderGets} coin(s)`);
            console.log(`  → Platform keeps:     ${adminGets} coin(s)\n`);

            console.log('📐 Calculation:');
            console.log(`  Math.floor(${testCoins} × ${config.responderCommissionPercentage}% / 100)`);
            console.log(`  = Math.floor(${(testCoins * config.responderCommissionPercentage / 100).toFixed(2)})`);
            console.log(`  = ${responderGets}\n`);

            // Show history
            const allConfigs = await CommissionConfig.find().sort({ createdAt: -1 }).limit(10);
            console.log('📜 Commission Config History:');
            console.log('───────────────────────────────────────────────────');
            allConfigs.forEach((cfg, index) => {
                const active = cfg.isActive ? '✅' : '  ';
                const date = cfg.createdAt.toISOString().split('T')[0];
                console.log(`${active} Responder: ${cfg.responderCommissionPercentage}% | Platform: ${cfg.adminCommissionPercentage}% | ${date}`);
            });
            console.log('');
        }

        await mongoose.disconnect();
        console.log('✅ Done\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        await mongoose.disconnect();
        process.exit(1);
    }
}

checkCommission();
