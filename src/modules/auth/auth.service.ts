import bcrypt from 'bcrypt';
import { admin } from '../../lib/firebase';
import { User, UserRole } from '../../models/User';
import { AppError } from '../../middleware/errorHandler';
import { coinService } from '../../services/coinService';

export const authService = {
  // Admin login with email/password
  async adminLogin(email: string, password: string) {
    try {
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
      let customToken;
      try {
        customToken = await admin.auth().createCustomToken(user.id, {
          role: user.role,
        });
      } catch (firebaseError: any) {
        console.error('Firebase createCustomToken error:', {
          error: firebaseError.message,
          code: firebaseError.code,
          stack: firebaseError.stack,
        });
        throw new AppError(500, `Failed to generate authentication token: ${firebaseError.message}`);
      }

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
    } catch (error) {
      // Re-throw AppErrors as-is
      if (error instanceof AppError) {
        throw error;
      }
      // Log and wrap unexpected errors
      console.error('Unexpected error in adminLogin:', error);
      throw new AppError(500, 'An unexpected error occurred during login');
    }
  },

  async verifyFirebaseToken(idToken: string) {
    try {
      console.log('🔐 Verifying Firebase token...');

      // Verify Firebase ID token
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log('✅ Firebase token verified successfully', {
          uid: decodedToken.uid,
          phone: decodedToken.phone_number,
          provider: decodedToken.firebase?.sign_in_provider,
        });
      } catch (firebaseError: any) {
        console.error('❌ Firebase token verification failed:', {
          error: firebaseError.message,
          code: firebaseError.code,
        });
        throw new AppError(401, `Invalid Firebase token: ${firebaseError.message}`);
      }

      const phone = decodedToken.phone_number;
      const firebaseUid = decodedToken.uid;

      if (!phone) {
        console.error('❌ Phone number not found in token', { uid: firebaseUid });
        throw new AppError(400, 'Phone number not found in token');
      }

      console.log('📱 Looking up user by phone:', phone);

      // Find or create user
      let user = await User.findOne({ phone });

      // Enforce: Admins must use email/password (no OTP)
      if (user && user.role === UserRole.ADMIN) {
        console.warn('⚠️  Admin attempted OTP login:', phone);
        throw new AppError(403, 'Admins must login with email and password');
      }

      if (!user) {
        console.log('👤 Creating new user:', { phone, firebaseUid });
        // Create new user with Firebase UID
        user = await User.create({
          phone,
          firebaseUid,
          role: UserRole.USER,
          coinBalance: 0,
          profile: {},
        });
        console.log('✅ New user created:', {
          id: user.id,
          phone: user.phone,
          firebaseUid: user.firebaseUid,
          role: user.role,
        });

        // Initialize user with default coins
        try {
          await coinService.initializeUserCoins(user.id);
          // Refresh user to get updated balance
          user = await User.findById(user.id) as any;
          console.log('💰 Initial coins credited:', user.coinBalance);
        } catch (coinError) {
          console.error('⚠️  Failed to initialize coins:', coinError);
          // Don't fail user creation if coin initialization fails
        }
      } else if (!user.firebaseUid) {
        console.log('🔄 Updating existing user with Firebase UID:', user.id);
        // Update existing user with Firebase UID if missing
        user.firebaseUid = firebaseUid;
        await user.save();
        console.log('✅ User updated with Firebase UID:', {
          id: user.id,
          phone: user.phone,
          firebaseUid: user.firebaseUid,
        });
      } else if (user.firebaseUid !== firebaseUid) {
        // Firebase UID changed (rare case)
        console.warn('⚠️  Firebase UID mismatch, updating:', {
          userId: user.id,
          oldUid: user.firebaseUid,
          newUid: firebaseUid,
        });
        user.firebaseUid = firebaseUid;
        await user.save();
        console.log('✅ User Firebase UID updated');
      } else {
        console.log('✅ Existing user found:', {
          id: user.id,
          phone: user.phone,
          firebaseUid: user.firebaseUid,
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
      console.error('❌ Unexpected error in verifyFirebaseToken:', error);
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

  async updateUserLanguage(userId: string, language: string) {
    const user = await User.findById(userId);
    if (!user) {
      throw new AppError(404, 'User not found');
    }

    user.profile.language = language;
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
    console.log('🔄 Updating user role:', {
      userId,
      requestedRole: role,
      hasVoiceText: !!voiceText,
      hasVoiceBlob: !!voiceBlob,
    });

    const user = await User.findById(userId);
    if (!user) {
      console.error('❌ User not found for role update:', userId);
      throw new AppError(404, 'User not found');
    }

    console.log('📝 Current user state:', {
      userId: user.id,
      currentRole: user.role,
      phone: user.phone,
    });

    // Validate role
    const validRoles = Object.values(UserRole);
    if (!validRoles.includes(role)) {
      console.error('❌ Invalid role provided:', role);
      throw new AppError(400, `Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    const previousRole = user.role;
    user.role = role;

    if (voiceText) {
      user.profile.voiceText = voiceText;
    }
    if (voiceBlob) {
      user.profile.voiceBlob = voiceBlob;
    }

    await user.save();

    console.log('✅ User role updated successfully:', {
      userId: user.id,
      previousRole,
      newRole: user.role,
      phone: user.phone,
    });

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
