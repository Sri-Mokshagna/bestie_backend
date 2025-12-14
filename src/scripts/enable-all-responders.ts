import mongoose from 'mongoose';
import { User, UserRole, UserStatus } from '../models/User';
import { Responder, KycStatus } from '../models/Responder';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Fix script to enable all responders for calls
 * This ensures:
 * 1. All responders have Responder documents
 * 2. All availability settings are enabled
 * 3. Responders are set to online
 */
async function enableAllResponders() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Get all responder users
        const responderUsers = await User.find({ 
            role: UserRole.RESPONDER,
            status: UserStatus.ACTIVE 
        });
        
        console.log(`📊 Found ${responderUsers.length} active responder users\n`);

        let created = 0;
        let updated = 0;

        for (const user of responderUsers) {
            let responderDoc = await Responder.findOne({ userId: user._id });

            if (!responderDoc) {
                // Create missing Responder document
                console.log(`📝 Creating Responder document for: ${user.profile?.name || user.phone}`);
                responderDoc = await Responder.create({
                    userId: user._id,
                    isOnline: true,
                    audioEnabled: true,
                    videoEnabled: true,
                    chatEnabled: true,
                    inCall: false,
                    kycStatus: KycStatus.VERIFIED,
                    earnings: {
                        totalCoins: 0,
                        pendingCoins: 0,
                        lockedCoins: 0,
                        redeemedCoins: 0,
                    },
                    rating: 0,
                    bio: user.profile?.bio || 'Available to help you',
                });
                created++;
                console.log(`   ✅ Created with all features enabled`);
            } else {
                // Update existing Responder document
                const needsUpdate = 
                    !responderDoc.audioEnabled || 
                    !responderDoc.videoEnabled || 
                    !responderDoc.chatEnabled;

                if (needsUpdate) {
                    console.log(`🔧 Updating Responder document for: ${user.profile?.name || user.phone}`);
                    responderDoc.audioEnabled = true;
                    responderDoc.videoEnabled = true;
                    responderDoc.chatEnabled = true;
                    responderDoc.inCall = false;
                    await responderDoc.save();
                    updated++;
                    console.log(`   ✅ Enabled all features`);
                }
            }

            // Also update User model to be consistent
            let userNeedsUpdate = false;
            if (!user.isOnline) {
                user.isOnline = true;
                userNeedsUpdate = true;
            }
            if (!user.audioEnabled) {
                user.audioEnabled = true;
                userNeedsUpdate = true;
            }
            if (!user.videoEnabled) {
                user.videoEnabled = true;
                userNeedsUpdate = true;
            }
            if (!user.chatEnabled) {
                user.chatEnabled = true;
                userNeedsUpdate = true;
            }
            if (user.inCall) {
                user.inCall = false;
                userNeedsUpdate = true;
            }

            if (userNeedsUpdate) {
                await user.save();
                console.log(`   ✅ Updated User model settings`);
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 SUMMARY:');
        console.log(`   - Responder documents created: ${created}`);
        console.log(`   - Responder documents updated: ${updated}`);
        console.log(`   - Total responders processed: ${responderUsers.length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('✅ All responders are now enabled for calls!');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Connection closed');
    }
}

enableAllResponders();
