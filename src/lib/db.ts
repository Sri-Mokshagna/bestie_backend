import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectDB() {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bestie';
    
    // PERFORMANCE: Configure connection pool for better performance
    await mongoose.connect(uri, {
      maxPoolSize: 50, // Max connections in pool
      minPoolSize: 10, // Min connections to maintain
      serverSelectionTimeoutMS: 5000, // Timeout for server selection
      socketTimeoutMS: 45000, // Socket timeout
      family: 4, // Use IPv4
    });
    
    logger.info('MongoDB connected successfully with connection pool (min: 10, max: 50)');

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
