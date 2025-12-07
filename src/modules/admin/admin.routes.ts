import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as adminController from './admin.controller';
import * as adminVoiceController from './admin-voice.controller';
import * as reportsController from './reports.controller';

const router = Router();

// All routes require admin authentication
router.use(authenticate);
router.use(authorize(UserRole.ADMIN));

// User management
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserDetails);
router.put('/users/:userId/status', adminController.updateUserStatus);
router.delete('/users/:userId', adminController.deleteUser);
router.put('/users/:userId/block', adminController.blockUser);

// Responder management
router.get('/responders', adminController.getAllResponders);
router.get('/responders/:responderId', adminController.getResponderDetails);
router.delete('/responders/:responderId', adminVoiceController.deleteResponderAccount);

// Voice recordings
router.get('/voice-recordings', adminVoiceController.getRespondersWithVoiceRecordings);

// Reports
router.get('/reports', reportsController.getReportedUsers);

// Analytics
router.get('/analytics/dashboard', adminController.getDashboardAnalytics);
router.get('/analytics/revenue', adminController.getRevenueAnalytics);

// Commission settings
router.get('/commission', adminController.getCommissionSettings);
router.put('/commission', adminController.updateCommissionSettings);

export default router;
