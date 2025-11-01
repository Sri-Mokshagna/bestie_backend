const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const readline = require('readline');

// Create readline interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function createAdmin() {
  try {
    // Load environment variables
    require('dotenv').config();

    console.log('🔧 Bestie Admin User Creation Script\n');

    // Get admin details
    const name = await question('Admin Name: ');
    const email = await question('Admin Email: ');
    const password = await question('Admin Password (min 6 chars): ');
    const phone = await question('Admin Phone (with country code, e.g., +919876543210): ');

    // Validate inputs
    if (!name || !email || !password || !phone) {
      console.error('❌ All fields are required!');
      process.exit(1);
    }

    if (password.length < 6) {
      console.error('❌ Password must be at least 6 characters!');
      process.exit(1);
    }

    if (!email.includes('@')) {
      console.error('❌ Invalid email format!');
      process.exit(1);
    }

    // Connect to MongoDB
    console.log('\n📡 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://admin:admin123@localhost:27017/bestie?authSource=admin';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // Get User model
    const User = mongoose.model('User', new mongoose.Schema({
      phone: String,
      role: String,
      coinBalance: Number,
      profile: {
        name: String,
        email: String,
        avatar: String,
        gender: String,
      },
      password: String,
      status: String,
    }, { timestamps: true }));

    // Check if admin already exists
    const existingAdmin = await User.findOne({ 'profile.email': email });
    if (existingAdmin) {
      console.error(`❌ Admin with email ${email} already exists!`);
      await mongoose.disconnect();
      process.exit(1);
    }

    // Hash password
    console.log('🔐 Hashing password...');
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create admin user
    console.log('👤 Creating admin user...');
    const admin = await User.create({
      phone: phone,
      role: 'admin',
      coinBalance: 0,
      profile: {
        name: name,
        email: email,
      },
      password: hashedPassword,
      status: 'active',
    });

    console.log('\n✅ Admin user created successfully!\n');
    console.log('📋 Admin Details:');
    console.log(`   Name: ${admin.profile.name}`);
    console.log(`   Email: ${admin.profile.email}`);
    console.log(`   Phone: ${admin.phone}`);
    console.log(`   Role: ${admin.role}`);
    console.log(`   ID: ${admin._id}\n`);
    console.log('🔑 Login Credentials:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}\n`);
    console.log('🚀 You can now login at: /admin/login\n');

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating admin:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
createAdmin().finally(() => rl.close());
