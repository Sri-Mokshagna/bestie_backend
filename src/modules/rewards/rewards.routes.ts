import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as rewardsController from './rewards.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get user's rewards data
router.get('/', rewardsController.getRewards);

// Redeem reward
router.post('/redeem', rewardsController.redeemReward);

export default router;
