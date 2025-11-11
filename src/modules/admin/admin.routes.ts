import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as adminController from './admin.controller';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(UserRole.ADMIN));

// User management
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/status', adminController.updateUserStatus);

// Responder management
router.get('/responders', adminController.getAllResponders);
router.get('/responders/:responderId', adminController.getResponderDetails);

// Analytics
router.get('/analytics/dashboard', adminController.getDashboardAnalytics);
router.get('/analytics/revenue', adminController.getRevenueAnalytics);

// Commission settings
router.get('/commission', adminController.getCommissionSettings);
router.put('/commission', adminController.updateCommissionSettings);

export default router;
