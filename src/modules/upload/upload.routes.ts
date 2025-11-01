import { Router } from 'express';
import { uploadController, uploadMiddleware } from './upload.controller';
import { authenticate } from '../../middleware/auth';
import { asyncHandler } from '../../lib/asyncHandler';

const router = Router();

// All upload routes require authentication
router.use(authenticate);

// Get presigned URL for direct upload (recommended for large files)
router.post('/presigned-url', asyncHandler(uploadController.getUploadUrl));

// Upload file directly to server (for smaller files)
router.post('/file', uploadMiddleware, asyncHandler(uploadController.uploadFile));

// Delete file
router.delete('/file', asyncHandler(uploadController.deleteFile));

export default router;
