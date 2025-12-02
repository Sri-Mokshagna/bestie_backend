import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as userController from './user.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get blocked users
router.get('/blocked', userController.getBlockedUsers);

// Block a user
router.post('/block/:userId', userController.blockUser);

// Unblock a user
router.post('/unblock/:userId', userController.unblockUser);

// Delete account
router.delete('/account', userController.deleteAccount);

// Update profile (language, etc.)
router.put('/profile', userController.updateProfile);

export default router;
