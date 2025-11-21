import { Router } from 'express';
import { redemptionController } from './redemption.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/authorize';
import { UserRole } from '../../models/User';

const router = Router();

// Protected routes
router.use(authenticate);

// Responder routes
router.post('/requests', redemptionController.createRedemptionRequest);
router.get('/my-requests', redemptionController.getMyRedemptions);

// Admin only routes
router.get(
  '/all',
  authorize([UserRole.ADMIN]),
  redemptionController.getAllRedemptions
);

router.put(
  '/:redemptionId/status',
  authorize([UserRole.ADMIN]),
  redemptionController.updateRedemptionStatus
);

router.get(
  '/stats',
  authorize([UserRole.ADMIN]),
  redemptionController.getRedemptionStats
);

export default router;
