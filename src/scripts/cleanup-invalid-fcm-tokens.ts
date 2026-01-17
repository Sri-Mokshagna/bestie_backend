/**
 * Clean Up Invalid FCM Tokens
 * 
 * This script checks all FCM tokens in database and removes invalid ones.
 * Run this periodically to keep stats accurate.
 * 
 * Usage:
 *   npx ts-node src/scripts/cleanup-invalid-fcm-tokens.ts
 */

import { User } from '../models/User';
import { connectDB } from '../lib/db';
import { admin } from '../lib/firebase';
import { logger } from '../lib/logger';

async function cleanupInvalidTokens() {
    try {
        // Connect to database
        await connectDB();

        console.log('🧹 Starting FCM token cleanup...\n');

        // Find all users with FCM tokens
        const users = await User.find({
            fcmToken: { $exists: true, $nin: [null, ''] }
        }).select('_id phone profile.name fcmToken role');

        console.log(`📊 Total users with FCM tokens: ${users.length}\n`);

        let validCount = 0;
        let invalidCount = 0;
        const invalidUsers: any[] = [];

        // Test each token
        for (const user of users) {
            try {
                // Send dry-run notification to test if token is valid
                await admin.messaging().send({
                    token: user.fcmToken,
                    data: { test: 'true' },
                }, true); // dry-run = true (doesn't actually send)

                console.log(`✅ Valid: ${user.phone || user._id} (${user.role})`);
                validCount++;

            } catch (error: any) {
                // Check if error is due to invalid token
                if (
                    error.code === 'messaging/registration-token-not-registered' ||
                    error.code === 'messaging/invalid-registration-token' ||
                    error.code === 'messaging/invalid-argument'
                ) {
                    console.log(`❌ Invalid: ${user.phone || user._id} (${user.role}) - ${error.code}`);

                    // Remove the invalid token
                    user.fcmToken = null;
                    await user.save();

                    invalidCount++;
                    invalidUsers.push({
                        phone: user.phone,
                        name: user.profile?.name || 'Unknown',
                        role: user.role,
                        error: error.code
                    });
                } else {
                    // Some other error (rate limit, network, etc.)
                    console.log(`⚠️ Error testing ${user.phone || user._id}: ${error.message}`);
                }
            }

            // Small delay to avoid rate limiting
            await sleep(100);
        }

        // Print summary
        console.log('\n' + '='.repeat(50));
        console.log('📊 CLEANUP SUMMARY');
        console.log('='.repeat(50));
        console.log(`Total checked: ${users.length}`);
        console.log(`✅ Valid tokens: ${validCount} (${Math.round(validCount / users.length * 100)}%)`);
        console.log(`❌ Invalid tokens removed: ${invalidCount} (${Math.round(invalidCount / users.length * 100)}%)`);

        if (invalidUsers.length > 0) {
            console.log('\n❌ Users with invalid tokens (need to re-login):');
            console.log('─'.repeat(50));
            invalidUsers.forEach((u, i) => {
                console.log(`${i + 1}. ${u.phone} - ${u.name} (${u.role})`);
            });

            console.log('\n💡 TIP: Ask these users to:');
            console.log('   1. Logout from app');
            console.log('   2. Login again');
            console.log('   3. Allow notifications when prompted');
            console.log('   → They will get a fresh FCM token');
        }

        console.log('\n✅ Cleanup complete!\n');

        process.exit(0);

    } catch (error) {
        console.error('❌ Script failed:', error);
        process.exit(1);
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the cleanup
cleanupInvalidTokens();
