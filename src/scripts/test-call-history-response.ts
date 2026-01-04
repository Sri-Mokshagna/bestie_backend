import mongoose from 'mongoose';
import { Call, CallStatus } from '../models/Call';
import { User } from '../models/User';
import { callService } from '../modules/calls/call.service';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Test call history response to verify responder data
 */
async function testCallHistoryResponse() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB\n');

        // Find a user who has call history
        const userWithCalls = await Call.findOne({
            status: { $in: [CallStatus.ENDED, CallStatus.REJECTED, CallStatus.MISSED] }
        }).lean();

        if (!userWithCalls) {
            console.log('❌ No calls found in database');
            return;
        }

        const testUserId = userWithCalls.userId.toString();
        console.log(`📊 Testing call history for user: ${testUserId}\n`);

        // Get call history using the service
        const callHistory = await callService.getCallHistory(testUserId);

        console.log(`📋 Retrieved ${callHistory.length} calls\n`);

        // Check first 3 calls
        for (let i = 0; i < Math.min(3, callHistory.length); i++) {
            const call = callHistory[i];
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`📞 Call ${i + 1}:`);
            console.log(`   Call ID: ${call.id}`);
            console.log(`   Type: ${call.type}`);
            console.log(`   Status: ${call.status}`);
            
            console.log('\n   👤 User Data:');
            console.log(`      id: ${call.user.id}`);
            console.log(`      name: "${call.user.name}"`);
            console.log(`      phone: "${call.user.phone}"`);
            console.log(`      avatar: ${call.user.profile?.avatar || 'N/A'}`);

            console.log('\n   🎯 Responder Data:');
            console.log(`      id: ${call.responder.id}`);
            console.log(`      name: "${call.responder.name}"`);
            console.log(`      phone: "${call.responder.phone}"`);
            console.log(`      avatar: ${call.responder.profile?.avatar || 'N/A'}`);

            // Check for issues
            const issues = [];
            if (call.responder.name === 'Responder') {
                issues.push('❌ Responder name is generic "Responder"');
            }
            if (!call.responder.name || call.responder.name === 'unknown') {
                issues.push('❌ Responder name is missing or unknown');
            }
            if (!call.responder.phone || call.responder.phone === '') {
                issues.push('⚠️  Responder phone is empty');
            }
            if (!call.responder.id || call.responder.id === 'unknown') {
                issues.push('❌ Responder ID is missing');
            }

            if (issues.length > 0) {
                console.log('\n   ⚠️  ISSUES:');
                issues.forEach(issue => console.log(`      ${issue}`));
            } else {
                console.log('\n   ✅ All responder data looks good!');
            }

            // Show what will be sent to frontend
            console.log('\n   📤 JSON Response (what Flutter receives):');
            console.log(JSON.stringify({
                id: call.id,
                type: call.type,
                status: call.status,
                responder: call.responder
            }, null, 2));
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.connection.close();
        console.log('✅ Connection closed');
    }
}

testCallHistoryResponse();
