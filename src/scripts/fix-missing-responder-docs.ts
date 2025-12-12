import mongoose from 'mongoose';
import { User } from '../models/User';
import { Responder, KycStatus } from '../models/Responder';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Migration script to create missing Responder documents
 * for users who have role='responder' but no Responder document
 */
async function fixMissingResponderDocuments() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Find all users with responder role
        const respondersInUsers = await User.find({ role: 'responder' });
        console.log(`📊 Found ${respondersInUsers.length} users with role='responder'\n`);

        let created = 0;
        let alreadyExists = 0;
        let errors = 0;

        for (const user of respondersInUsers) {
            try {
                // Check if Responder document exists
                const existingResponder = await Responder.findOne({ userId: user._id });

                if (existingResponder) {
                    console.log(`✓ Responder document already exists for: ${user.profile?.name || user.phone}`);
                    alreadyExists++;
                    continue;
                }

                // Create missing Responder document
                const newResponder = await Responder.create({
                    userId: user._id,
                    isOnline: false,
                    audioEnabled: true,
                    videoEnabled: true,
                    chatEnabled: true,
                    inCall: false,
                    kycStatus: KycStatus.VERIFIED, // Auto-verify existing responders
                    kycDocs: {
                        idProof: undefined,
                        voiceProof: undefined,
                    },
                    earnings: {
                        totalCoins: 0,
                        pendingCoins: 0,
                        lockedCoins: 0,
                        redeemedCoins: 0,
                    },
                    rating: 0,
                    bio: user.profile?.bio || 'Available to help you',
                });

                console.log(`✅ Created Responder document for: ${user.profile?.name || user.phone} (ID: ${newResponder._id})`);
                created++;
            } catch (error: any) {
                console.error(`❌ Error creating Responder for user ${user._id}:`, error.message);
                errors++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('📈 Migration Summary:');
        console.log('='.repeat(60));
        console.log(`✅ Created: ${created}`);
        console.log(`✓ Already existed: ${alreadyExists}`);
        console.log(`❌ Errors: ${errors}`);
        console.log(`📊 Total processed: ${respondersInUsers.length}`);
        console.log('='.repeat(60) + '\n');

        // Verify the fix
        const totalResponders = await Responder.countDocuments({});
        const totalResponderUsers = await User.countDocuments({ role: 'responder' });

        console.log('🔍 Verification:');
        console.log(`   Users with role='responder': ${totalResponderUsers}`);
        console.log(`   Responder documents: ${totalResponders}`);

        if (totalResponders === totalResponderUsers) {
            console.log('   ✅ Data is now consistent!\n');
        } else {
            console.log('   ⚠️  Still some inconsistency - please review\n');
        }

        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    } catch (error: any) {
        console.error('❌ Migration failed:', error.message);
        await mongoose.disconnect();
        process.exit(1);
    }
}

fixMissingResponderDocuments();
