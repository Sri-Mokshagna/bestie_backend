import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Get all active responders
router.get('/', asyncHandler(responderController.getResponders));

// Get my own responder profile (authenticated) - MUST come before /status
router.get('/me', authenticate, asyncHandler(responderController.getMyProfile));

// Update responder online status (authenticated) - MUST come before /:id
router.put('/status', authenticate, asyncHandler(responderController.updateStatus));

// Update responder availability settings (authenticated)
router.put('/availability', authenticate, asyncHandler(responderController.updateAvailability));

// Disable all availability options (authenticated)
router.post('/availability/disable-all', authenticate, asyncHandler(responderController.disableAllAvailability));

// Get responder by ID - MUST be last to avoid catching /status
router.get('/:id', asyncHandler(responderController.getResponderById));

export default router;
