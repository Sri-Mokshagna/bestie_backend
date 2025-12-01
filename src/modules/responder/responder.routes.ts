import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Get all active responders
router.get('/', asyncHandler(responderController.getResponders));

// Update responder online status (authenticated) - MUST come before /:id
router.put('/status', authenticate, asyncHandler(responderController.updateStatus));

// Get responder by ID - MUST be last to avoid catching /status
router.get('/:id', asyncHandler(responderController.getResponderById));

export default router;
