import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as promotionController from './promotion.controller';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(UserRole.ADMIN));

// Promotion CRUD
router.get('/', promotionController.getAllPromotions);
router.get('/:promotionId', promotionController.getPromotionDetails);
router.post('/', promotionController.createPromotion);
router.put('/:promotionId', promotionController.updatePromotion);
router.delete('/:promotionId', promotionController.deletePromotion);
router.put('/:promotionId/toggle', promotionController.togglePromotionStatus);

export default router;
