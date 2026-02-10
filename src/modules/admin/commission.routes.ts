import { Router } from 'express';
import { commissionController } from './commission.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/authorize';
import { UserRole } from '../../models/User';

const router = Router();

// Protected routes - Admin only
router.use(authenticate);
router.use(authorize([UserRole.ADMIN]));

// FIX: Frontend calls /api/admin/commission (root) instead of /config
// Support both endpoints for backward compatibility
router.get('/', commissionController.getCommissionConfig);
router.get('/config', commissionController.getCommissionConfig);
router.put('/config', commissionController.updateCommissionConfig);
router.get('/history', commissionController.getCommissionHistory);

export default router;
