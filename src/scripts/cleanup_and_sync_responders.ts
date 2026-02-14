import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User, UserRole } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Clean up orphaned Responder documents and sync User/Responder models
 */
async function cleanupAndSync() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        console.log('=== STEP 1: DELETE ORPHANED RESPONDER DOCUMENTS ===');

        // Find all responders
        const allResponders = await Responder.find({}).select('userId').lean();
        const responderUserIds = allResponders.map(r => r.userId);

        // Find which users exist
        const existingUsers = await User.find({ _id: { $in: responderUserIds } }).select('_id').lean();
        const existingUserIds = new Set(existingUsers.map(u => u._id.toString()));

        // Find orphaned responders
        const orphanedIds = allResponders
            .filter(r => !existingUserIds.has(r.userId.toString()))
            .map(r => r._id);

        console.log(`Found ${orphanedIds.length} orphaned Responder documents`);

        if (orphanedIds.length > 0) {
            const deleteResult = await Responder.deleteMany({ _id: { $in: orphanedIds } });
            console.log(`✅ Deleted ${deleteResult.deletedCount} orphaned Responder documents\n`);
        } else {
            console.log('✅ No orphaned documents to delete\n');
        }

        console.log('=== STEP 2: SYNC USER → RESPONDER MODEL ===');

        // Find all users with role responder
        const responderUsers = await User.find({ role: UserRole.RESPONDER }).lean();
        console.log(`Found ${responderUsers.length} users with role 'responder'`);

        let syncedCount = 0;
        let createdCount = 0;
        let skippedCount = 0;

        for (const user of responderUsers) {
            // Find corresponding Responder document
            let responder = await Responder.findOne({ userId: user._id });

            if (!responder) {
                console.log(`⚠️ User ${user._id} has no Responder document - skipping sync`);
                skippedCount++;
                continue;
            }

            // Sync toggle states from User to Responder
            const needsUpdate =
                responder.audioEnabled !== user.audioEnabled ||
                responder.videoEnabled !== user.videoEnabled ||
                responder.chatEnabled !== user.chatEnabled ||
                responder.isOnline !== user.isOnline;

            if (needsUpdate) {
                responder.audioEnabled = user.audioEnabled || false;
                responder.videoEnabled = user.videoEnabled || false;
                responder.chatEnabled = user.chatEnabled || false;
                responder.isOnline = user.isOnline || false;
                responder.lastOnlineAt = user.lastOnlineAt || new Date();

                await responder.save();
                syncedCount++;
            }
        }

        console.log(`✅ Synced ${syncedCount} Responder documents from User model`);
        console.log(`⚠️ Skipped ${skippedCount} users (no Responder document)`);
        console.log('');

        console.log('=== STEP 3: VERIFICATION ===');

        const usersWithToggles = await User.countDocuments({
            role: UserRole.RESPONDER,
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        const respondersWithToggles = await Responder.countDocuments({
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        console.log(`Users with toggles: ${usersWithToggles}`);
        console.log(`Responders with toggles: ${respondersWithToggles}`);
        console.log(`Difference: ${Math.abs(usersWithToggles - respondersWithToggles)}`);

        if (usersWithToggles === respondersWithToggles) {
            console.log('✅ Models are now in sync!\n');
        } else {
            console.log('⚠️ Models still have differences (users without Responder docs)\n');
        }

        console.log('=== CLEANUP COMPLETE ===');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

cleanupAndSync();
