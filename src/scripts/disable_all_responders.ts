import { connect } from 'mongoose';
import { Responder } from '../models/Responder';
import { User, UserRole } from '../models/User';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Disable ALL responders immediately
 * They will re-enable their toggles when they log back in
 */
async function disableAllResponders() {
    try {
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await connect(mongoUri);
        console.log('✅ Connected to database\n');

        console.log('=== DISABLE ALL RESPONDERS ===');
        console.log('This will disable ALL responder toggles.');
        console.log('They will show as offline until they log back in and re-enable toggles.\n');

        // Count before
        const beforeCount = await Responder.countDocuments({
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        console.log(`Responders with toggles enabled BEFORE: ${beforeCount}\n`);

        // Disable all responders
        const responderResult = await Responder.updateMany(
            {},
            {
                $set: {
                    isOnline: false,
                    audioEnabled: false,
                    videoEnabled: false,
                    chatEnabled: false,
                }
            }
        );

        // Disable all users with role responder
        const userResult = await User.updateMany(
            { role: UserRole.RESPONDER },
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
        console.log(`✅ Updated ${responderResult.modifiedCount} Responder documents`);
        console.log(`✅ Updated ${userResult.modifiedCount} User documents\n`);

        // Count after
        const afterCount = await Responder.countDocuments({
            $or: [
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        const onlineToUsers = await Responder.countDocuments({
            kycStatus: 'verified',
            $or: [
                { isOnline: true },
                { audioEnabled: true },
                { videoEnabled: true },
                { chatEnabled: true },
            ]
        });

        console.log('=== VERIFICATION ===');
        console.log(`Responders with toggles enabled AFTER: ${afterCount}`);
        console.log(`Responders appearing "online" to users: ${onlineToUsers}\n`);

        console.log('✅ COMPLETE!');
        console.log('Users will now see 0 online responders.');
        console.log('Responders can log in and re-enable their toggles to go online.');

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

disableAllResponders();
