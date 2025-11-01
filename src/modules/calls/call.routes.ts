import { Router } from 'express';
import { callController } from './call.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.post('/initiate', authenticate, asyncHandler(callController.initiateCall));
router.post('/:callId/accept', authenticate, asyncHandler(callController.acceptCall));
router.post('/:callId/reject', authenticate, asyncHandler(callController.rejectCall));
router.post('/:callId/end', authenticate, asyncHandler(callController.endCall));
router.get('/:callId/status', authenticate, asyncHandler(callController.getCallStatus));
router.get('/logs/:partnerId', authenticate, asyncHandler(callController.getCallLogs));
router.put('/:callId/duration', authenticate, asyncHandler(callController.updateCallDuration));

export default router;
