import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Public routes
router.get('/', asyncHandler(responderController.getResponders));
router.get('/:responderId', asyncHandler(responderController.getResponderById));

// Responder routes (authenticated)
router.patch('/status', authenticate, asyncHandler(responderController.toggleOnlineStatus));
router.put('/availability', authenticate, asyncHandler(responderController.updateAvailabilityStatus));
router.get('/availability', authenticate, asyncHandler(responderController.getAvailabilityStatus));
router.post('/apply', authenticate, asyncHandler(responderController.applyAsResponder));

// Admin routes (authenticated + admin role)
router.get('/admin/pending', authenticate, asyncHandler(responderController.getPendingApplications));
router.post('/admin/approve/:responderId', authenticate, asyncHandler(responderController.approveResponder));
router.post('/admin/reject/:responderId', authenticate, asyncHandler(responderController.rejectResponder));

export default router;
