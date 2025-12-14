import mongoose from 'mongoose';
import { Call } from '../models/Call';
import { User } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Find calls with invalid responder IDs
 */
async function findInvalidResponderCalls() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Get all calls for user Rocky
        const rockyUser = await User.findOne({ 'profile.name': 'Rocky' });
        if (!rockyUser) {
            console.log('❌ Rocky user not found');
            return;
        }

        console.log(`📊 Checking calls for Rocky (${rockyUser._id})\n`);

        const calls = await Call.find({
            userId: rockyUser._id
        }).sort({ createdAt: -1 }).lean();

        console.log(`Found ${calls.length} total calls\n`);

        let invalidCount = 0;

        for (const call of calls) {
            const responderExists = await User.findById(call.responderId);
            
            if (!responderExists) {
                invalidCount++;
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log(`❌ INVALID CALL FOUND:`);
                console.log(`   Call ID: ${call._id}`);
                console.log(`   Responder ID: ${call.responderId}`);
                console.log(`   Type: ${call.type}`);
                console.log(`   Status: ${call.status}`);
                console.log(`   Created: ${call.createdAt}`);
                console.log(`   ⚠️  This responder ID does NOT exist in the database!`);
                console.log();
            }
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        console.log(`📊 Summary:`);
        console.log(`   Total calls: ${calls.length}`);
        console.log(`   Invalid responder IDs: ${invalidCount}`);
        console.log(`   Valid calls: ${calls.length - invalidCount}`);

        if (invalidCount > 0) {
            console.log(`\n🔧 Fix: Delete these ${invalidCount} orphaned calls`);
            console.log(`   Run: npx tsx src/scripts/fix-orphaned-calls.ts`);
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('\n✅ Connection closed');
    }
}

findInvalidResponderCalls();
