import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * One-time script to fix responders stuck in isOnline: true state
 * despite having old lastOnlineAt timestamps.
 * 
 * This fixes the immediate problem while the cleanup service fix prevents recurrence.
 */
async function fixStuckOnlineResponders() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        console.log('=== FIX STUCK ONLINE RESPONDERS ===');
        console.log(`Current time: ${now.toISOString()}`);
        console.log(`2 hours ago: ${twoHoursAgo.toISOString()}\n`);

        // Find responders who are stuck with old or missing lastOnlineAt
        const stuckResponders = await Responder.find({
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
        }).select('userId lastOnlineAt isOnline audioEnabled videoEnabled chatEnabled').lean();

        console.log(`Found ${stuckResponders.length} responders to fix\n`);

        if (stuckResponders.length === 0) {
            console.log('✅ No stuck responders found. Everything is clean!');
            process.exit(0);
        }

        // Show sample of what will be fixed
        console.log('Sample of responders to be fixed:');
        stuckResponders.slice(0, 5).forEach((r, i) => {
            const lastOnline = r.lastOnlineAt ? r.lastOnlineAt.toISOString() : 'NULL';
            console.log(`  ${i + 1}. isOnline: ${r.isOnline}, lastOnlineAt: ${lastOnline}`);
        });
        console.log('');

        const userIds = stuckResponders.map(r => r.userId);

        // Fix Responder model: disable toggles and set offline
        const responderResult = await Responder.updateMany(
            { _id: { $in: stuckResponders.map(r => r._id) } },
            {
                $set: {
                    isOnline: false,
                    audioEnabled: false,
                    videoEnabled: false,
                    chatEnabled: false,
                    lastOnlineAt: new Date() // Set to current time
                }
            }
        );

        // Fix User model: keep models in sync
        const userResult = await User.updateMany(
            { _id: { $in: userIds } },
            {
                $set: {
                    isOnline: false,
                    audioEnabled: false,
                    videoEnabled: false,
                    chatEnabled: false,
                    lastOnlineAt: new Date()
                }
            }
        );

        console.log('=== RESULTS ===');
        console.log(`✅ Fixed ${responderResult.modifiedCount} responders`);
        console.log(`✅ Fixed ${userResult.modifiedCount} users`);
        console.log('\nThese responders will now:');
        console.log('- Show as offline to users in the app');
        console.log('- Have all toggles (audio/video/chat) disabled');
        console.log('- Need to log in and manually re-enable toggles to go online');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

fixStuckOnlineResponders();
