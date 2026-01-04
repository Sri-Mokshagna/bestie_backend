import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectDB() {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
    
    await mongoose.connect(uri);
    
    logger.info('MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'MongoDB connection error');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed due to app termination');
      process.exit(0);
    });
  } catch (error) {
    logger.error({ error }, 'Failed to connect to MongoDB');
    process.exit(1);
  }
}

export { mongoose };
