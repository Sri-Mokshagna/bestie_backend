import { Router } from 'express';
import { walletController } from './wallet.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.get('/balance', authenticate, asyncHandler(walletController.getBalance));
router.get('/transactions', authenticate, asyncHandler(walletController.getTransactions));
router.get('/coin-plans', asyncHandler(walletController.getCoinPlans));
router.post('/purchase', authenticate, asyncHandler(walletController.verifyPurchase));
router.post('/ad-reward', authenticate, asyncHandler(walletController.verifyAdReward));

// Payment gateway routes
router.post('/payment/create-order', authenticate, asyncHandler(walletController.createPaymentOrder));
router.post('/payment/verify', authenticate, asyncHandler(walletController.verifyPaymentAndCredit));

export default router;
