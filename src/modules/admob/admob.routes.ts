import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as admobController from './admob.controller';

const router = Router();

// Public webhook endpoint (no auth required - verified by signature)
router.post('/ssv', admobController.ssvWebhook);

// User endpoints (require authentication)
router.get('/config', admobController.getRewardConfig);
router.post('/reward/video', authenticate, admobController.creditRewardedVideo);
router.post('/reward/interstitial', authenticate, admobController.creditInterstitial);
router.get('/history', authenticate, admobController.getAdRewardHistory);
router.get('/stats', authenticate, admobController.getAdRewardStats);
router.get('/can-watch', authenticate, admobController.checkCanWatchAd);

// Admin endpoints
router.put('/config', authenticate, authorize(UserRole.ADMIN), admobController.updateRewardConfig);

export default router;
