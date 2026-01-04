import mongoose from 'mongoose';
import { User, UserRole, UserStatus } from '../models/User';
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
            isOnline: true,
            isAvailable: true,
            audioEnabled: true,
            videoEnabled: true,
            chatEnabled: true,
            inCall: false,
            profile: {
                name: 'Test Responder',
                gender: 'female',
                bio: 'I am here to help you feel better. Let\'s talk!',
                language: 'English',
            },
        });

        console.log('✅ Test responder created successfully!');
        console.log('ID:', testResponder._id);
        console.log('Phone:', testResponder.phone);
        console.log('Name:', testResponder.profile.name);

        // Create another test responder
        const testResponder2 = await User.create({
            phone: '+919876543211',
            role: UserRole.RESPONDER,
            status: UserStatus.ACTIVE,
            coinBalance: 0,
            isOnline: true,
            isAvailable: true,
            audioEnabled: true,
            videoEnabled: false, // Video disabled
            chatEnabled: true,
            inCall: false,
            profile: {
                name: 'Sarah',
                gender: 'female',
                bio: 'Your friendly listener. I\'m here for you 24/7.',
                language: 'English',
            },
        });

        console.log('\n✅ Second test responder created successfully!');
        console.log('ID:', testResponder2._id);
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
