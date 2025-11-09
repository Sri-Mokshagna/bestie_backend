import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as coinConfigController from './coinConfig.controller';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(UserRole.ADMIN));

// GET /api/admin/coin-config - Get current coin configuration
router.get('/', coinConfigController.getCoinConfig);

// PUT /api/admin/coin-config - Update coin configuration
router.put('/', coinConfigController.updateCoinConfig);

export default router;
