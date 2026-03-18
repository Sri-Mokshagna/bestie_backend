import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// OTP-specific rate limiter: max 5 OTP triggers per IP per 10 minutes
// This is critical to prevent bot abuse driving up Firebase SMS costs
const otpRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,
  message: { error: 'Too many OTP requests. Please wait 10 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Rate limit by both IP and phone number to prevent IP rotation abuse
    const phone = req.body?.phone ?? '';
    const ip = req.ip ?? 'unknown';
    return `${ip}:${phone}`;
  },
});

// OTP verify limiter: max 10 verifications per IP per 10 minutes
const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 10,
  message: { error: 'Too many verification attempts. Please wait 10 minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Check phone status before OTP (strict rate limited)
router.post('/check-phone', otpRateLimiter, asyncHandler(authController.checkPhone));


// Admin login (email/password)
router.post('/admin/login', asyncHandler(authController.adminLogin));

// User/Responder login (OTP)
router.post('/verify-otp', otpVerifyLimiter, asyncHandler(authController.verifyOtp));

// User/Responder login with password (no auth required)
router.post('/login-password', asyncHandler(authController.loginWithPassword));

// Set/reset password (auth required – user just verified OTP)
router.post('/set-password', authenticate, asyncHandler(authController.setPassword));

// Token refresh
router.post('/refresh', asyncHandler(authController.refreshToken));

// Get current user
router.get('/me', authenticate, asyncHandler(authController.getMe));

// Update user gender
router.put('/update-gender', authenticate, asyncHandler(authController.updateGender));

// Update user language
router.put('/update-language', authenticate, asyncHandler(authController.updateLanguage));

// Update user role
router.put('/update-role', authenticate, asyncHandler(authController.updateRole));

// Update user profile
router.put('/update-profile', authenticate, asyncHandler(authController.updateProfile));

// Register/update FCM token for push notifications
router.put('/fcm-token', authenticate, asyncHandler(authController.updateFcmToken));

// Logout
router.post('/logout', authenticate, asyncHandler(authController.logout));

export default router;
