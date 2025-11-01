import { Router } from 'express';
import { chatController } from './chat.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

router.get('/', authenticate, asyncHandler(chatController.getChats));
router.post('/', authenticate, asyncHandler(chatController.createChat));
router.get('/:roomId/messages', authenticate, asyncHandler(chatController.getMessages));
router.post('/:chatId/messages', authenticate, asyncHandler(chatController.sendMessage));

export default router;
