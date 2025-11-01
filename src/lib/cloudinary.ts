import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const cloudinaryService = {
  /**
   * Upload file to Cloudinary
   */
  async uploadFile(
    file: Buffer,
    fileName: string,
    contentType: string,
    folder: 'aadhar' | 'voice' | 'avatars' = 'aadhar'
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Determine resource type based on content type
      const resourceType = contentType.startsWith('audio/') ? 'video' : 'image';
      
      // Create upload stream
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `bestie/${folder}`,
          resource_type: resourceType,
          public_id: `${Date.now()}-${fileName.replace(/\.[^/.]+$/, '')}`, // Remove extension
          use_filename: true,
          unique_filename: true,
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else if (result) {
            resolve(result.secure_url);
          } else {
            reject(new Error('Upload failed'));
          }
        }
      );

      // Convert Buffer to Stream and pipe to Cloudinary
      const bufferStream = Readable.from(file);
      bufferStream.pipe(uploadStream);
    });
  },

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (error) {
      console.error('Failed to delete file from Cloudinary:', error);
      throw error;
    }
  },

  /**
   * Delete file by URL
   */
  async deleteFileByUrl(url: string): Promise<void> {
    try {
      // Extract public_id from Cloudinary URL
      // URL format: https://res.cloudinary.com/cloud_name/image/upload/v1234567890/folder/file.jpg
      const urlParts = url.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      
      if (uploadIndex === -1) {
        throw new Error('Invalid Cloudinary URL');
      }

      // Get everything after 'upload/' and before the file extension
      const publicIdWithExtension = urlParts.slice(uploadIndex + 2).join('/');
      const publicId = publicIdWithExtension.replace(/\.[^/.]+$/, ''); // Remove extension

      await this.deleteFile(publicId);
    } catch (error) {
      console.error('Failed to delete file by URL:', error);
      throw error;
    }
  },

  /**
   * Get optimized image URL with transformations
   */
  getOptimizedUrl(
    publicId: string,
    options?: {
      width?: number;
      height?: number;
      quality?: number;
      format?: string;
    }
  ): string {
    return cloudinary.url(publicId, {
      transformation: [
        {
          width: options?.width,
          height: options?.height,
          quality: options?.quality || 'auto',
          fetch_format: options?.format || 'auto',
          crop: 'limit',
        },
      ],
      secure: true,
    });
  },
};
