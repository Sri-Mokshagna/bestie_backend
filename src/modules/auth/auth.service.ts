import bcrypt from 'bcrypt';
import { admin } from '../../lib/firebase';
import { User, UserRole } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';

export const authService = {
  // Admin login with email/password
  async adminLogin(email: string, password: string) {
    // Find admin user by email (include password field)
    const user = await User.findOne({ 
      'profile.email': email,
      role: UserRole.ADMIN 
    }).select('+password');

    if (!user) {
      throw new AppError(401, 'Invalid credentials');
    }

    // Check if password is set
    if (!user.password) {
      throw new AppError(401, 'Password not set for this admin');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      throw new AppError(401, 'Invalid credentials');
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new AppError(403, 'Account is not active');
    }

    // Create a Firebase custom token; client will sign in to Firebase with it
    const customToken = await admin.auth().createCustomToken(user.id, {
      role: user.role,
    });

    return {
      customToken,
      user: {
        id: user.id,
        phone: user.phone,
        role: user.role,
        coinBalance: user.coinBalance,
        profile: user.profile,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    };
  },

  async verifyFirebaseToken(idToken: string) {
    try {
      // Verify Firebase ID token
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const phone = decodedToken.phone_number;

      if (!phone) {
        throw new AppError(400, 'Phone number not found in token');
      }

      // Find or create user
      let user = await User.findOne({ phone });

      // Enforce: Admins must use email/password (no OTP)
      if (user && user.role === UserRole.ADMIN) {
        throw new AppError(403, 'Admins must login with email and password');
      }

      if (!user) {
        user = await User.create({
          phone,
          role: UserRole.USER,
          coinBalance: 0,
          profile: {},
        });
      }

      // Return only user; client should send Firebase ID token on subsequent requests
      return {
        user: {
          id: user.id,
          phone: user.phone,
          role: user.role,
          coinBalance: user.coinBalance,
          profile: user.profile,
          status: user.status,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, 'Invalid Firebase token');
    }
  },

  // JWT refresh removed; clients should refresh Firebase ID tokens via Firebase SDK

  async getUserById(userId: string) {
    const user = await User.findById(userId);
    if (!user) return null;

    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      coinBalance: user.coinBalance,
      profile: user.profile,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  async updateUserGender(userId: string, gender: string) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    user.profile.gender = gender;
    await user.save();

    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      coinBalance: user.coinBalance,
      profile: user.profile,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  async updateUserRole(userId: string, role: UserRole, voiceText?: string, voiceBlob?: string) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    user.role = role;
    if (voiceText) {
      user.profile.voiceText = voiceText;
    }
    if (voiceBlob) {
      user.profile.voiceBlob = voiceBlob;
    }
    await user.save();

    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      coinBalance: user.coinBalance,
      profile: user.profile,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },

  async updateUserProfile(userId: string, profileData: {
    name?: string;
    email?: string;
    bio?: string;
    avatarBase64?: string;
  }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    // Update profile fields
    if (profileData.name !== undefined) {
      user.profile.name = profileData.name;
    }
    if (profileData.email !== undefined) {
      user.profile.email = profileData.email;
    }
    if (profileData.bio !== undefined) {
      user.profile.bio = profileData.bio;
    }
    
    // Handle avatar upload
    if (profileData.avatarBase64) {
      // In a real implementation, you would upload to a cloud storage service
      // For now, we'll store the base64 string directly (not recommended for production)
      user.profile.avatar = `data:image/jpeg;base64,${profileData.avatarBase64}`;
    }

    await user.save();

    return {
      id: user.id,
      phone: user.phone,
      role: user.role,
      coinBalance: user.coinBalance,
      profile: user.profile,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  },
};
