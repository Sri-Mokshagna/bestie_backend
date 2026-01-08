import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';
import { UserRole } from '../../models/User';

const router = Router();

// Public routes
// Get all active responders
router.get('/', asyncHandler(responderController.getResponders));

// Responder authenticated routes - MUST come before /:id
router.get('/me', authenticate, asyncHandler(responderController.getMyProfile));
router.put('/status', authenticate, asyncHandler(responderController.updateStatus));
router.put('/availability', authenticate, asyncHandler(responderController.updateAvailability));
router.post('/availability/disable-all', authenticate, asyncHandler(responderController.disableAllAvailability));

// Application route (user applying to become responder)
router.post('/apply', authenticate, asyncHandler(responderController.applyAsResponder));

// Admin routes for managing responder applications
router.get('/admin/pending', authenticate, authorize(UserRole.ADMIN), asyncHandler(responderController.getPendingApplications));
router.post('/admin/approve/:responderId', authenticate, authorize(UserRole.ADMIN), asyncHandler(responderController.approveResponder));
router.post('/admin/reject/:responderId', authenticate, authorize(UserRole.ADMIN), asyncHandler(responderController.rejectResponder));

// Get responder by ID - MUST be last to avoid catching /status, /me, /admin/*
router.get('/:id', asyncHandler(responderController.getResponderById));

export default router;
