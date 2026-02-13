import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

async function diagnoseResponderStatus() {
    try {
        // Connect to database
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        const now = new Date();
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

        console.log('=== DIAGNOSTIC REPORT ===');
        console.log(`Current time: ${now.toISOString()}`);
        console.log(`2 hours ago: ${twoHoursAgo.toISOString()}\n`);

        // 1. Count responders with null lastOnlineAt
        const nullLastOnlineCount = await Responder.countDocuments({
            $or: [
                { lastOnlineAt: { $exists: false } },
                { lastOnlineAt: null }
            ]
        });
        console.log(`1. Responders with NULL lastOnlineAt: ${nullLastOnlineCount}`);

        // 2. Count responders showing as "online" (have any toggle enabled)
        const onlineByToggleCount = await Responder.countDocuments({
            kycStatus: 'verified',
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true }
            ]
        });
        console.log(`2. Responders with ANY toggle enabled: ${onlineByToggleCount}`);

        // 3. Count responders with isOnline: true
        const isOnlineTrueCount = await Responder.countDocuments({
            kycStatus: 'verified',
            isOnline: true
        });
        console.log(`3. Responders with isOnline: true: ${isOnlineTrueCount}`);

        // 4. Count responders with lastOnlineAt > 2 hours ago (old)
        const oldLastOnlineCount = await Responder.countDocuments({
            kycStatus: 'verified',
            lastOnlineAt: { $lt: twoHoursAgo }
        });
        console.log(`4. Responders with lastOnlineAt > 2 hours ago: ${oldLastOnlineCount}`);

        // 5. THE PROBLEM: Responders who should be disabled but aren't
        const shouldBeDisabled = await Responder.countDocuments({
            kycStatus: 'verified',
            isOnline: false,
            lastOnlineAt: { $lt: twoHoursAgo },
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true }
            ]
        });
        console.log(`5. Responders that SHOULD be disabled (offline > 2h but toggles ON): ${shouldBeDisabled}\n`);

        // 6. Get detailed info on responders showing as online
        console.log('=== DETAILED BREAKDOWN ===');
        const onlineResponders = await Responder.find({
            kycStatus: 'verified',
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true }
            ]
        })
            .select('userId isOnline audioEnabled videoEnabled chatEnabled lastOnlineAt')
            .lean()
            .limit(50);

        console.log(`\nShowing first ${onlineResponders.length} responders with toggles enabled:\n`);

        for (const resp of onlineResponders) {
            const lastOnline = resp.lastOnlineAt
                ? resp.lastOnlineAt.toISOString()
                : 'NULL';
            const timeSinceOnline = resp.lastOnlineAt
                ? `${Math.round((now.getTime() - resp.lastOnlineAt.getTime()) / (1000 * 60 * 60))}h ago`
                : 'N/A';

            console.log(`ID: ${resp.userId.toString().substring(0, 8)}... | isOnline: ${resp.isOnline} | Audio: ${resp.audioEnabled} | Video: ${resp.videoEnabled} | Chat: ${resp.chatEnabled} | LastOnline: ${lastOnline} (${timeSinceOnline})`);
        }

        // 7. Check if cleanup service query would find them
        console.log('\n=== CLEANUP SERVICE SIMULATION ===');
        const cleanupQuery = {
            isOnline: false,
            lastOnlineAt: { $lt: twoHoursAgo },
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ],
        };

        const wouldBeFound = await Responder.countDocuments(cleanupQuery);
        console.log(`Responders that cleanup service WOULD find: ${wouldBeFound}`);

        // 8. Check User model sync
        console.log('\n=== USER MODEL SYNC CHECK ===');
        const userToggleCount = await User.countDocuments({
            role: 'responder',
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true }
            ]
        });
        console.log(`Users (responders) with toggles enabled in User model: ${userToggleCount}`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

diagnoseResponderStatus();
