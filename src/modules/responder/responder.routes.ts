import { Router } from 'express';
import { responderController } from './responder.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// Get all active responders
router.get('/', asyncHandler(responderController.getResponders));

// Get responder by ID
router.get('/:id', asyncHandler(responderController.getResponderById));

// Update responder online status (authenticated)
router.put('/status', authenticate, asyncHandler(responderController.updateStatus));

export default router;
