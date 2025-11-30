import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Public routes
router.get('/', asyncHandler(responderController.getResponders));

// Responder routes (authenticated) - MUST come before /:responderId
router.patch('/status', authenticate, asyncHandler(responderController.toggleOnlineStatus));
router.put('/availability', authenticate, asyncHandler(responderController.updateAvailabilityStatus));
router.get('/availability', authenticate, asyncHandler(responderController.getAvailabilityStatus));
router.post('/apply', authenticate, asyncHandler(responderController.applyAsResponder));

// Admin routes (authenticated + admin role) - MUST come before /:responderId
router.get('/admin/pending', authenticate, asyncHandler(responderController.getPendingApplications));
router.post('/admin/approve/:responderId', authenticate, asyncHandler(responderController.approveResponder));
router.post('/admin/reject/:responderId', authenticate, asyncHandler(responderController.rejectResponder));

// Dynamic route - MUST be last to avoid catching specific paths
router.get('/:responderId', asyncHandler(responderController.getResponderById));

export default router;
