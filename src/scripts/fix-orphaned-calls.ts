import mongoose from 'mongoose';
import { Call, CallStatus } from '../models/Call';
import { User } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Fix orphaned calls (calls with deleted responders/users)
 * Options:
 * 1. Delete orphaned calls
 * 2. Mark them with special status (not recommended)
 */
async function fixOrphanedCalls() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        console.log('🔍 Finding orphaned calls...\n');

        // Find all calls
        const allCalls = await Call.find({}).lean();
        console.log(`📊 Total calls in database: ${allCalls.length}`);

        const orphanedCalls = [];
        const callsWithNullResponder = [];

        // Check each call
        for (const call of allCalls) {
            // Check for null responderId
            if (!call.responderId || call.responderId === null) {
                callsWithNullResponder.push(call);
                continue;
            }

            // Check if responder exists
            const responderExists = await User.exists({ _id: call.responderId });
            if (!responderExists) {
                orphanedCalls.push(call);
            }

            // Also check if user exists (optional, but good to check)
            const userExists = await User.exists({ _id: call.userId });
            if (!userExists) {
                console.log(`⚠️  Call ${call._id} has deleted user: ${call.userId}`);
            }
        }

        console.log(`\n📋 ORPHANED CALLS FOUND:`);
        console.log(`   Calls with NULL responderId: ${callsWithNullResponder.length}`);
        console.log(`   Calls with deleted responders: ${orphanedCalls.length}`);
        console.log(`   Total to clean: ${callsWithNullResponder.length + orphanedCalls.length}\n`);

        if (callsWithNullResponder.length === 0 && orphanedCalls.length === 0) {
            console.log('✅ No orphaned calls found! Database is clean.');
            return;
        }

        // Show sample of orphaned calls
        console.log('📝 Sample of orphaned calls:');
        const samples = [...callsWithNullResponder, ...orphanedCalls].slice(0, 5);
        for (const call of samples) {
            console.log(`   - Call ${call._id}: created ${call.createdAt}, status: ${call.status}`);
            console.log(`     User: ${call.userId}, Responder: ${call.responderId || 'NULL'}`);
        }

        console.log('\n❓ What would you like to do?');
        console.log('   1. DELETE all orphaned calls (RECOMMENDED)');
        console.log('   2. Keep them (will show as "Responder null" in UI)\n');

        // For automation, we'll delete them
        console.log('🗑️  DELETING orphaned calls...\n');

        // Delete calls with null responderId
        if (callsWithNullResponder.length > 0) {
            const nullIds = callsWithNullResponder.map(c => c._id);
            const result = await Call.deleteMany({ _id: { $in: nullIds } });
            console.log(`   ✅ Deleted ${result.deletedCount} calls with NULL responderId`);
        }

        // Delete calls with deleted responders
        if (orphanedCalls.length > 0) {
            const orphanedIds = orphanedCalls.map(c => c._id);
            const result = await Call.deleteMany({ _id: { $in: orphanedIds } });
            console.log(`   ✅ Deleted ${result.deletedCount} calls with deleted responders`);
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📊 CLEANUP SUMMARY:');
        console.log(`   Total calls deleted: ${callsWithNullResponder.length + orphanedCalls.length}`);
        console.log(`   Remaining calls: ${allCalls.length - callsWithNullResponder.length - orphanedCalls.length}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log('✅ Call history is now clean!');
        console.log('💡 Users will only see calls with valid responders.\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Connection closed');
    }
}

fixOrphanedCalls();
