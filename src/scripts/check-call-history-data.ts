import mongoose from 'mongoose';
import { Call } from '../models/Call';
import { User } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Check call history data to find why responders show as null
 */
async function checkCallHistoryData() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Get all calls
        const allCalls = await Call.find({})
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();

        console.log(`📊 Found ${allCalls.length} recent calls\n`);

        for (const call of allCalls) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📞 Call ID: ${call._id}`);
            console.log(`   Status: ${call.status}`);
            console.log(`   Type: ${call.type}`);
            console.log(`   Created: ${call.createdAt}`);

            // Check if userId exists
            const userId = call.userId;
            console.log(`\n   👤 User ID: ${userId}`);
            console.log(`   Type: ${typeof userId}`);
            
            const user = await User.findById(userId);
            if (user) {
                console.log(`   ✅ User found: ${user.profile?.name || user.phone}`);
                console.log(`      Role: ${user.role}`);
            } else {
                console.log(`   ❌ User NOT FOUND in database!`);
            }

            // Check if responderId exists
            const responderId = call.responderId;
            console.log(`\n   🎯 Responder ID: ${responderId}`);
            console.log(`   Type: ${typeof responderId}`);
            
            if (!responderId || responderId === null || responderId === 'null') {
                console.log(`   ❌ RESPONDER ID IS NULL/INVALID!`);
                console.log(`   ⚠️  This call has NO responder reference`);
            } else {
                const responder = await User.findById(responderId);
                if (responder) {
                    console.log(`   ✅ Responder found: ${responder.profile?.name || responder.phone}`);
                    console.log(`      Role: ${responder.role}`);
                    console.log(`      Status: ${responder.status}`);
                } else {
                    console.log(`   ❌ Responder NOT FOUND in database!`);
                    console.log(`   ⚠️  User with ID ${responderId} doesn't exist`);
                    console.log(`   💡 This is why call history shows "Responder null"`);
                }
            }
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Summary of issues
        console.log('📊 SUMMARY OF ISSUES:\n');

        const callsWithNullResponder = await Call.countDocuments({
            $or: [
                { responderId: null },
                { responderId: { $exists: false } }
            ]
        });
        console.log(`   Calls with NULL responderId: ${callsWithNullResponder}`);

        // Find calls where responderId doesn't match any user
        const allCallsWithResponder = await Call.find({
            responderId: { $ne: null, $exists: true }
        }).lean();

        let orphanedCalls = 0;
        for (const call of allCallsWithResponder) {
            const exists = await User.exists({ _id: call.responderId });
            if (!exists) {
                orphanedCalls++;
            }
        }
        console.log(`   Calls with deleted/missing responder: ${orphanedCalls}`);
        console.log(`   Total problematic calls: ${callsWithNullResponder + orphanedCalls}`);

        if (callsWithNullResponder + orphanedCalls > 0) {
            console.log('\n💡 RECOMMENDED ACTIONS:');
            console.log('   1. Delete calls with null responderId');
            console.log('   2. Delete calls referencing deleted users');
            console.log('   3. Or assign a default "Unknown Responder" user');
            console.log('\n   Run: npx tsx src/scripts/fix-orphaned-calls.ts');
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ Connection closed');
    }
}

checkCallHistoryData();
