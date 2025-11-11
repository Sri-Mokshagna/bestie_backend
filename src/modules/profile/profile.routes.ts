import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as profileController from './profile.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Notification preferences
router.get('/notifications', profileController.getNotificationPreferences);
router.put('/notifications', profileController.updateNotificationPreferences);

export default router;
