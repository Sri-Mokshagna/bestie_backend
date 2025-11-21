import { Router } from 'express';
import { commissionController } from './commission.controller';
import { authenticate } from '../../middleware/auth';
import { authorize } from '../../middleware/authorize';
import { UserRole } from '../../models/User';

const router = Router();

// Protected routes - Admin only
router.use(authenticate);
router.use(authorize([UserRole.ADMIN]));

router.get('/config', commissionController.getCommissionConfig);
router.put('/config', commissionController.updateCommissionConfig);
router.get('/history', commissionController.getCommissionHistory);

export default router;
