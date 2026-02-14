import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User, UserRole } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Immediately disable all responders with lastOnlineAt > 2 hours ago
 */
async function disableInactiveNow() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        console.log('=== DISABLE INACTIVE RESPONDERS ===');
        console.log(`Current time: ${now.toISOString()}`);
        console.log(`2 hours ago: ${twoHoursAgo.toISOString()}\n`);

        // Find responders to disable (inactive for 2+ hours but still have toggles enabled)
        const toDisable = await Responder.find({
            $and: [
                {
                    $or: [
                        { lastOnlineAt: { $lt: twoHoursAgo } },
                        { lastOnlineAt: { $exists: false } },
                        { lastOnlineAt: null }
                    ]
                },
                {
                    $or: [
                        { audioEnabled: true },
                        { videoEnabled: true },
                        { chatEnabled: true },
                    ]
                }
            ]
        }).select('userId lastOnlineAt audioEnabled videoEnabled chatEnabled').lean();

        console.log(`Found ${toDisable.length} inactive responders to disable\n`);

        if (toDisable.length === 0) {
            console.log('✅ No inactive responders found. All clean!');
            process.exit(0);
        }

        // Show sample
        console.log('Sample of responders to disable:');
        toDisable.slice(0, 5).forEach((r, i) => {
            console.log(`  ${i + 1}. lastOnlineAt: ${r.lastOnlineAt?.toISOString() || 'NULL'}, toggles: audio=${r.audioEnabled} video=${r.videoEnabled} chat=${r.chatEnabled}`);
        });
        console.log('');

        // Disable in Responder model
        const responderResult = await Responder.updateMany(
            { _id: { $in: toDisable.map(r => r._id) } },
            {
                $set: {
                    isOnline: false,
                    audioEnabled: false,
                    videoEnabled: false,
                    chatEnabled: false,
                }
            }
        );

        // Disable in User model (keep synced)
        const userIds = toDisable.map(r => r.userId);
        const userResult = await User.updateMany(
            { _id: { $in: userIds } },
            {
                $set: {
                    isOnline: false,
                    audioEnabled: false,
                    videoEnabled: false,
                    chatEnabled: false,
                }
            }
        );

        console.log('=== RESULTS ===');
        console.log(`✅ Disabled ${responderResult.modifiedCount} responders`);
        console.log(`✅ Disabled ${userResult.modifiedCount} users`);
        console.log('');

        // Verify
        const stillOnline = await Responder.countDocuments({
            kycStatus: 'verified',
            $or: [
                { isOnline: true },
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        console.log('=== VERIFICATION ===');
        console.log(`Responders still appearing "online": ${stillOnline}`);
        console.log('');

        console.log('✅ COMPLETE - Users will now see the correct number of online responders!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

disableInactiveNow();
