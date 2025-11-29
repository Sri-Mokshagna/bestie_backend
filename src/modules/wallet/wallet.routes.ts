import { Router } from 'express';
import { walletController } from './wallet.controller';
import * as responderWalletController from './responder-wallet.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// User wallet routes
router.get('/balance', authenticate, asyncHandler(walletController.getBalance));
router.get('/transactions', authenticate, asyncHandler(walletController.getTransactions));
router.get('/coin-plans', asyncHandler(walletController.getCoinPlans));
router.post('/purchase', authenticate, asyncHandler(walletController.verifyPurchase));
router.post('/ad-reward', authenticate, asyncHandler(walletController.verifyAdReward));

// Payment gateway routes
router.post('/payment/create-order', authenticate, asyncHandler(walletController.createPaymentOrder));
router.post('/payment/verify', authenticate, asyncHandler(walletController.verifyPaymentAndCredit));

// Responder wallet routes
router.get('/responder/balance', authenticate, authorize(UserRole.RESPONDER), responderWalletController.getResponderBalance);
router.get('/responder/transactions', authenticate, authorize(UserRole.RESPONDER), responderWalletController.getResponderTransactions);

export default router;
