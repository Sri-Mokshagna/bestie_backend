import mongoose from 'mongoose';
import { User, UserRole } from '../models/User';
import { Responder } from '../models/Responder';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Diagnostic script to check responder availability settings
 * Run this to see why a call might be failing
 */
async function checkResponderAvailability() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Get all responders
        const responderUsers = await User.find({ role: UserRole.RESPONDER });
        console.log(`📊 Found ${responderUsers.length} responder users\n`);

        for (const user of responderUsers) {
            const responderDoc = await Responder.findOne({ userId: user._id });

            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`👤 Responder: ${user.profile?.name || user.phone}`);
            console.log(`   User ID: ${user._id}`);
            console.log(`   Phone: ${user.phone}`);
            console.log('\n   📱 User Model Settings:');
            console.log(`      - isOnline: ${user.isOnline}`);
            console.log(`      - isAvailable: ${user.isAvailable}`);
            console.log(`      - audioEnabled: ${user.audioEnabled}`);
            console.log(`      - videoEnabled: ${user.videoEnabled}`);
            console.log(`      - chatEnabled: ${user.chatEnabled}`);
            console.log(`      - inCall: ${user.inCall}`);
            console.log(`      - status: ${user.status}`);

            if (responderDoc) {
                console.log('\n   📋 Responder Model Settings:');
                console.log(`      - isOnline: ${responderDoc.isOnline}`);
                console.log(`      - audioEnabled: ${responderDoc.audioEnabled}`);
                console.log(`      - videoEnabled: ${responderDoc.videoEnabled}`);
                console.log(`      - chatEnabled: ${responderDoc.chatEnabled}`);
                console.log(`      - inCall: ${responderDoc.inCall}`);
                console.log(`      - kycStatus: ${responderDoc.kycStatus}`);

                // Check for mismatches or issues
                const issues = [];
                if (!user.isOnline) issues.push('❌ User is OFFLINE');
                if (!responderDoc.isOnline) issues.push('⚠️  Responder doc shows OFFLINE');
                if (!responderDoc.audioEnabled) issues.push('❌ AUDIO calls DISABLED in Responder doc');
                if (!responderDoc.videoEnabled) issues.push('❌ VIDEO calls DISABLED in Responder doc');
                if (!responderDoc.chatEnabled) issues.push('⚠️  CHAT DISABLED in Responder doc');
                if (responderDoc.inCall) issues.push('⚠️  Currently IN CALL');

                if (issues.length > 0) {
                    console.log('\n   ⚠️  ISSUES FOUND:');
                    issues.forEach(issue => console.log(`      ${issue}`));
                    console.log('\n   💡 SOLUTION: Run the fix script or update availability settings');
                } else {
                    console.log('\n   ✅ All settings look good! Calls should work.');
                }
            } else {
                console.log('\n   ❌ NO RESPONDER DOCUMENT FOUND!');
                console.log('      This responder needs a Responder document created.');
                console.log('      Run: npm run script:fix-missing-responder-docs');
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Connection closed');
    }
}

checkResponderAvailability();
