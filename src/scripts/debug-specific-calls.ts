import mongoose from 'mongoose';
import { Call } from '../models/Call';
import { User } from '../models/User';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Debug specific calls that show "Responder" without name
 */
async function debugSpecificCalls() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Check these specific calls
        const callIds = [
            '693d3f361fee4e57a9676bff',
            '693d3dee1fee4e57a9676bcf',
            '693d3bf411d749bb5bc59664'
        ];

        for (const callId of callIds) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📞 Analyzing Call: ${callId}\n`);

            const call = await Call.findById(callId).lean();
            
            if (!call) {
                console.log('❌ Call not found!\n');
                continue;
            }

            console.log(`   Call Type: ${call.type}`);
            console.log(`   Status: ${call.status}`);
            console.log(`   User ID: ${call.userId}`);
            console.log(`   Responder ID: ${call.responderId}`);
            console.log(`   Responder ID Type: ${typeof call.responderId}`);
            console.log();

            // Check if user exists
            const user = await User.findById(call.userId).lean();
            console.log(`   👤 User: ${user ? user.profile?.name || user.phone : '❌ NOT FOUND'}`);

            // Check if responder exists
            const responder = await User.findById(call.responderId).lean();
            console.log(`   🎯 Responder: ${responder ? responder.profile?.name || responder.phone : '❌ NOT FOUND'}`);
            
            if (responder) {
                console.log(`      - Responder Name: "${responder.profile?.name}"`);
                console.log(`      - Responder Phone: "${responder.phone}"`);
                console.log(`      - Responder Role: "${responder.role}"`);
                console.log(`      - Responder Status: "${responder.status}"`);
                console.log(`      - Profile Keys: ${Object.keys(responder.profile || {})}`);
            }

            console.log();

            // Now test with populate
            const callWithPopulate = await Call.findById(callId)
                .populate({
                    path: 'responderId',
                    select: 'profile phone role',
                    options: { strictPopulate: false }
                })
                .lean();

            console.log(`   📤 Populated Responder:`, callWithPopulate.responderId);
            console.log();
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Connection closed');
    }
}

debugSpecificCalls();
