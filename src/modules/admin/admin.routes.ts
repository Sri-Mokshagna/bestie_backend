import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { UserRole } from '../../models/User';
import * as adminController from './admin.controller';
import * as adminVoiceController from './admin-voice.controller';
import * as reportsController from './reports.controller';
import * as coinConfigController from './coinConfig.controller';
import * as payoutController from '../responder/payout.controller';
import * as notificationController from './notification.controller';

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
router.post('/responders/:responderId/verify-voice', adminVoiceController.verifyVoiceRecording);
router.post('/responders/:responderId/block', adminVoiceController.blockResponder);

// Reports
router.get('/reports', reportsController.getReportedUsers);
router.put('/reports/:reportId', reportsController.updateReportStatus);

// Analytics
router.get('/analytics/dashboard', adminController.getDashboardAnalytics);
router.get('/analytics/revenue', adminController.getRevenueAnalytics);

// Commission settings
router.get('/commission', adminController.getCommissionSettings);
router.put('/commission', adminController.updateCommissionSettings);

// Payout management
router.get('/payouts', payoutController.getAllPayouts);
router.put('/payouts/:payoutId/process', payoutController.processPayout);

// Coin Config
router.get('/coin-config', coinConfigController.getCoinConfig);
router.put('/coin-config', coinConfigController.updateCoinConfig);

// Coin Plans CRUD
router.get('/coin-plans', coinConfigController.getCoinPlans);
router.post('/coin-plans', coinConfigController.createCoinPlan);
router.put('/coin-plans/:planId', coinConfigController.updateCoinPlan);
router.delete('/coin-plans/:planId', coinConfigController.deleteCoinPlan);

// Notifications
router.get('/notifications/stats', notificationController.getNotificationStats);
router.post('/notifications/broadcast', notificationController.sendBroadcastNotification);
router.post('/notifications/user/:userId', notificationController.sendUserNotification);

export default router;
