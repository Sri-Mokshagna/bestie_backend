import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Admin login (email/password)
router.post('/admin/login', asyncHandler(authController.adminLogin));

// User/Responder login (OTP)
router.post('/verify-otp', asyncHandler(authController.verifyOtp));

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

// Logout
router.post('/logout', authenticate, asyncHandler(authController.logout));

export default router;
