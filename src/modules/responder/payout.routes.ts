import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as payoutController from './payout.controller';
import { getPayoutBalance } from './payout.balance.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Responder routes
router.get('/earnings', authorize(UserRole.RESPONDER), payoutController.getEarnings);
router.get('/history', authorize(UserRole.RESPONDER), payoutController.getPayoutHistory);
router.post('/request', authorize(UserRole.RESPONDER), payoutController.requestPayout);

// Admin routes
router.get('/all', authorize(UserRole.ADMIN), payoutController.getAllPayouts);
router.get('/balance', authorize(UserRole.ADMIN), getPayoutBalance);
router.put('/:payoutId/process', authorize(UserRole.ADMIN), payoutController.processPayout);

export default router;
