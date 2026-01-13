import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { authService } from './auth.service';
import { AppError } from '../../middleware/errorHandler';
import { User } from '../../models/User';

export const authController = {
  // Admin login with email/password
  async adminLogin(req: AuthRequest, res: Response) {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError(400, 'Email and password are required');
    }

    const result = await authService.adminLogin(email, password);

    // Return Firebase custom token for client to sign into Firebase
    res.json({
      customToken: result.customToken,
      user: result.user,
    });
  },
  async verifyOtp(req: AuthRequest, res: Response) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        throw new AppError(400, 'ID token is required');
      }

      const result = await authService.verifyFirebaseToken(idToken);

      // Set user online after successful login
      if (result.user) {
        // Update User model
        await User.findByIdAndUpdate(result.user.id, { isOnline: true });

        // CRITICAL FIX: Also update Responder model if user is a responder
        // This ensures responder appears online in admin panel immediately after first login
        if (result.user.role === 'responder') {
          const { Responder } = require('../../models/Responder');
          await Responder.findOneAndUpdate(
            { userId: result.user.id },
            { isOnline: true, lastOnlineAt: new Date() },
            { upsert: false } // Don't create if doesn't exist
          );
        }
      }

      // Ensure response is sent properly
      return res.status(200).json({
        user: result.user,
      });
    } catch (error) {
      console.error('Verify OTP error:', error);
      throw error;
    }
  },

  async refreshToken(_req: AuthRequest, res: Response) {
    // JWT flow disabled; clients should refresh Firebase ID tokens via Firebase SDK
    return res.status(410).json({ error: 'JWT flow disabled; use Firebase ID token' });
  },

  async getMe(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const user = await authService.getUserById(req.user.id);

    if (!user) {
      throw new AppError(404, 'User not found');
    }

    res.json(user);
  },

  async updateGender(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { gender } = req.body;
    if (!gender || !['male', 'female'].includes(gender)) {
      throw new AppError(400, 'Valid gender is required (male or female)');
    }

    const user = await authService.updateUserGender(req.user.id, gender);
    res.json({ user });
  },

  async updateLanguage(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { language } = req.body;
    if (!language) {
      throw new AppError(400, 'Language is required');
    }

    const validLanguages = ['en', 'hi', 'te', 'ta', 'kn', 'ml', 'mr'];
    if (!validLanguages.includes(language)) {
      throw new AppError(400, 'Invalid language code');
    }

    const user = await authService.updateUserLanguage(req.user.id, language);
    res.json({ user });
  },

  async updateRole(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { role, voiceText, voiceBlob } = req.body;
    if (!role) {
      throw new AppError(400, 'Role is required');
    }

    const user = await authService.updateUserRole(req.user.id, role, voiceText, voiceBlob);
    res.json({ user });
  },

  async updateProfile(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { name, email, bio, avatarBase64 } = req.body;

    const user = await authService.updateUserProfile(req.user.id, {
      name,
      email,
      bio,
      avatarBase64,
    });

    res.json({ user });
  },

  async logout(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    // Clear FCM token on logout (optional - prevents notifications after logout)
    await User.findByIdAndUpdate(req.user.id, { fcmToken: null });

    res.json({ message: 'Logged out successfully' });
  },

  /**
   * Register/update FCM token for push notifications
   * This is ADDITIVE - doesn't affect existing functionality
   */
  async updateFcmToken(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      throw new AppError(400, 'Valid FCM token is required');
    }

    await User.findByIdAndUpdate(req.user.id, { fcmToken });

    res.json({ success: true, message: 'FCM token registered' });
  },
};
