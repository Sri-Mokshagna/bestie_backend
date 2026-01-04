import mongoose from 'mongoose';
import { User, UserRole, UserStatus } from '../models/User';
import { Responder, KycStatus } from '../models/Responder';
import dotenv from 'dotenv';

dotenv.config();

async function addTestResponder() {
    try {
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
        await mongoose.connect(mongoUri);
        console.log('Connected to MongoDB');

        // Create test responder user
        const testResponder = await User.create({
            phone: '+919876543210',
            role: UserRole.RESPONDER,
            status: UserStatus.ACTIVE,
            coinBalance: 0,
            profile: {
                name: 'Test Responder',
                gender: 'female',
                bio: 'I am here to help you feel better. Let\'s talk!',
                language: 'English',
            },
        });

        // Create corresponding Responder document
        const responderDoc1 = await Responder.create({
            userId: testResponder._id,
            isOnline: true,
            audioEnabled: true,
            videoEnabled: true,
            chatEnabled: true,
            inCall: false,
            kycStatus: KycStatus.VERIFIED,
            earnings: {
                totalCoins: 0,
                pendingCoins: 0,
                lockedCoins: 0,
                redeemedCoins: 0,
            },
            rating: 0,
            bio: testResponder.profile.bio,
        });

        console.log('✅ Test responder created successfully!');
        console.log('User ID:', testResponder._id);
        console.log('Responder ID:', responderDoc1._id);
        console.log('Phone:', testResponder.phone);
        console.log('Name:', testResponder.profile.name);

        // Create another test responder
        const testResponder2 = await User.create({
            phone: '+919876543211',
            role: UserRole.RESPONDER,
            status: UserStatus.ACTIVE,
            coinBalance: 0,
            profile: {
                name: 'Sarah',
                gender: 'female',
                bio: 'Your friendly listener. I\'m here for you 24/7.',
                language: 'English',
            },
        });

        // Create corresponding Responder document
        const responderDoc2 = await Responder.create({
            userId: testResponder2._id,
            isOnline: true,
            audioEnabled: true,
            videoEnabled: false, // Video disabled
            chatEnabled: true,
            inCall: false,
            kycStatus: KycStatus.VERIFIED,
            earnings: {
                totalCoins: 0,
                pendingCoins: 0,
                lockedCoins: 0,
                redeemedCoins: 0,
            },
            rating: 0,
            bio: testResponder2.profile.bio,
        });

        console.log('\n✅ Second test responder created successfully!');
        console.log('User ID:', testResponder2._id);
        console.log('Responder ID:', responderDoc2._id);
        console.log('Phone:', testResponder2.phone);
        console.log('Name:', testResponder2.profile.name);

        await mongoose.disconnect();
        console.log('\n✅ Done! Disconnected from MongoDB');
    } catch (error: any) {
        console.error('❌ Error:', error.message);
        if (error.code === 11000) {
            console.log('Note: Responder with this phone number already exists');
        }
        await mongoose.disconnect();
        process.exit(1);
    }
}

addTestResponder();
