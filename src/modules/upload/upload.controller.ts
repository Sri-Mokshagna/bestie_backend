import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { cloudinaryService } from '../../lib/cloudinary';
import { AppError } from '../../middleware/errorHandler';
import multer from 'multer';

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow images and audio files
    const allowedMimes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/webm',
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images and audio files are allowed.'));
    }
  },
});

export const uploadMiddleware = upload.single('file');

export const uploadController = {
  /**
   * Get upload configuration (Cloudinary doesn't need presigned URLs)
   * This endpoint is kept for backward compatibility
   */
  async getUploadUrl(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { fileName, contentType, folder } = req.body;

    if (!fileName || !contentType || !folder) {
      throw new AppError(400, 'fileName, contentType, and folder are required');
    }

    if (!['aadhar', 'voice', 'avatars'].includes(folder)) {
      throw new AppError(400, 'Invalid folder. Must be aadhar, voice, or avatars');
    }

    // For Cloudinary, we don't use presigned URLs
    // Client should upload directly to /api/upload/file endpoint
    res.json({
      message: 'Use /api/upload/file endpoint to upload files',
      folder,
      fileName,
    });
  },

  /**
   * Upload file directly to server (then to Cloudinary)
   */
  async uploadFile(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    const { folder } = req.body;

    if (!folder || !['aadhar', 'voice', 'avatars'].includes(folder)) {
      throw new AppError(400, 'Invalid folder. Must be aadhar, voice, or avatars');
    }

    const fileUrl = await cloudinaryService.uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      folder as 'aadhar' | 'voice' | 'avatars'
    );

    res.json({
      fileUrl,
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size,
    });
  },

  /**
   * Delete file
   */
  async deleteFile(req: AuthRequest, res: Response) {
    if (!req.user) {
      throw new AppError(401, 'Not authenticated');
    }

    const { fileUrl } = req.body;

    if (!fileUrl) {
      throw new AppError(400, 'fileUrl is required');
    }

    await cloudinaryService.deleteFileByUrl(fileUrl);

    res.json({ message: 'File deleted successfully' });
  },
};
