import 'dotenv/config';
import bcrypt from 'bcrypt';
import { connectDB } from '../lib/db';
import { User, UserRole, UserStatus } from '../models/User';

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@bestie.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const phone = process.env.ADMIN_PHONE || '+9990000001';

  if (!email || !password || !phone) {
    console.error('Missing ADMIN_EMAIL, ADMIN_PASSWORD or ADMIN_PHONE in env');
    process.exit(1);
  }

  await connectDB();

  const hashed = await bcrypt.hash(password, 10);

  const existing = await User.findOne({ 'profile.email': email, role: UserRole.ADMIN }).select('+password');

  if (existing) {
    existing.password = hashed;
    existing.status = UserStatus.ACTIVE;
    if (existing.phone !== phone) existing.phone = phone;
    await existing.save();
    console.log(`Updated admin password for ${email}`);
  } else {
    await User.create({
      phone,
      role: UserRole.ADMIN,
      coinBalance: 0,
      profile: { email, name: 'Administrator' },
      password: hashed,
      status: UserStatus.ACTIVE,
    });
    console.log(`Created admin user ${email}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
