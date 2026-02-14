import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User, UserRole } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Diagnostic script to investigate responder data inconsistencies
 */
async function diagnoseResponderData() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        console.log('=== DIAGNOSTIC REPORT ===\n');

        // 1. Count total responder documents
        const totalResponders = await Responder.countDocuments({});
        console.log(`📊 Total Responder documents: ${totalResponders}`);

        // 2. Count total users with role responder
        const totalResponderUsers = await User.countDocuments({ role: UserRole.RESPONDER });
        console.log(`👥 Total Users with role 'responder': ${totalResponderUsers}`);

        // 3. Count verified responders
        const verifiedResponders = await Responder.countDocuments({ kycStatus: 'verified' });
        console.log(`✅ Verified responders: ${verifiedResponders}\n`);

        // 4. Check for orphaned Responder documents (no matching User)
        console.log('=== CHECKING FOR ORPHANED RESPONDER DOCUMENTS ===');
        const allResponders = await Responder.find({}).select('userId').lean();
        const responderUserIds = allResponders.map(r => r.userId);

        const existingUsers = await User.find({ _id: { $in: responderUserIds } }).select('_id').lean();
        const existingUserIds = new Set(existingUsers.map(u => u._id.toString()));

        const orphanedResponders = allResponders.filter(r => !existingUserIds.has(r.userId.toString()));
        console.log(`🗑️ Orphaned Responder documents (no User): ${orphanedResponders.length}`);

        if (orphanedResponders.length > 0) {
            console.log('   Sample orphaned IDs:', orphanedResponders.slice(0, 5).map(r => r._id));
        }
        console.log('');

        // 5. Check responders showing as online
        console.log('=== ONLINE STATUS ANALYSIS ===');

        const respondersWithOnlineFlag = await Responder.countDocuments({ isOnline: true });
        console.log(`🟢 Responders with isOnline: true → ${respondersWithOnlineFlag}`);

        const respondersWithToggles = await Responder.countDocuments({
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });
        console.log(`🔊 Responders with any toggle enabled → ${respondersWithToggles}`);

        // This is what getResponders would return (verified + any toggle OR isOnline)
        const effectivelyOnline = await Responder.countDocuments({
            kycStatus: 'verified',
            $or: [
                { isOnline: true },
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });
        console.log(`👁️ Responders appearing "online" to users → ${effectivelyOnline}\n`);

        // 6. Check lastOnlineAt distribution
        console.log('=== LAST ONLINE AT ANALYSIS ===');
        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const nullLastOnline = await Responder.countDocuments({ lastOnlineAt: null });
        const missingLastOnline = await Responder.countDocuments({ lastOnlineAt: { $exists: false } });
        const recentLastOnline = await Responder.countDocuments({ lastOnlineAt: { $gte: twoHoursAgo } });
        const oldLastOnline = await Responder.countDocuments({ lastOnlineAt: { $lt: oneDayAgo } });

        console.log(`   lastOnlineAt = null: ${nullLastOnline}`);
        console.log(`   lastOnlineAt missing: ${missingLastOnline}`);
        console.log(`   lastOnlineAt < 2 hours ago: ${recentLastOnline}`);
        console.log(`   lastOnlineAt > 1 day old: ${oldLastOnline}\n`);

        // 7. Check what the fix script WOULD find
        console.log('=== WHAT FIX SCRIPT TARGETS ===');
        const targetedByFixScript = await Responder.find({
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

        console.log(`🎯 Responders matching fix script criteria: ${targetedByFixScript.length}`);
        if (targetedByFixScript.length > 0) {
            console.log('   Sample matches:');
            targetedByFixScript.slice(0, 5).forEach((r, i) => {
                console.log(`   ${i + 1}. lastOnlineAt: ${r.lastOnlineAt || 'NULL'}, isOnline: ${r.isOnline}, toggles: audio=${r.audioEnabled} video=${r.videoEnabled} chat=${r.chatEnabled}`);
            });
        }
        console.log('');

        // 8. Check User model vs Responder model sync
        console.log('=== USER vs RESPONDER SYNC CHECK ===');
        const usersWithToggles = await User.countDocuments({
            role: UserRole.RESPONDER,
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });
        console.log(`🔊 Users (role=responder) with toggles enabled: ${usersWithToggles}`);
        console.log(`🔊 Responder docs with toggles enabled: ${respondersWithToggles}`);
        console.log(`   Difference: ${Math.abs(usersWithToggles - respondersWithToggles)}\n`);

        // 9. Sample of "online" responders
        console.log('=== SAMPLE OF "ONLINE" RESPONDERS ===');
        const sampleOnline = await Responder.find({
            kycStatus: 'verified',
            $or: [
                { isOnline: true },
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        }).limit(5).select('userId lastOnlineAt isOnline audioEnabled videoEnabled chatEnabled').lean();

        for (const r of sampleOnline) {
            const user = await User.findById(r.userId).select('phone profile.name').lean();
            console.log(`\n👤 ${user?.profile?.name || user?.phone || 'Unknown'}`);
            console.log(`   isOnline: ${r.isOnline}`);
            console.log(`   lastOnlineAt: ${r.lastOnlineAt?.toISOString() || 'NULL'}`);
            console.log(`   toggles: audio=${r.audioEnabled} video=${r.videoEnabled} chat=${r.chatEnabled}`);
        }

        console.log('\n=== DIAGNOSIS COMPLETE ===');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

diagnoseResponderData();
