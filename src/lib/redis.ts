import Redis from 'ioredis';
import { logger } from './logger';

const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';
const REDIS_URL = process.env.REDIS_URL;

let redis: Redis | null = null;

if (REDIS_ENABLED) {
  try {
    if (REDIS_URL) {
      // Production: Use REDIS_URL (from Render Redis service)
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ blocking operations
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('Redis connection failed after 3 retries. Disabling Redis.');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          logger.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
          return delay;
        },
        lazyConnect: true,
        // Production settings
        connectTimeout: 10000,
        commandTimeout: 5000,
        // TLS settings for Render Redis
        tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
      });
    } else {
      // Development: Use individual host/port
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
      
      redis = new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: null, // Required for BullMQ blocking operations
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Redis connection failed after 3 retries. Disabling Redis.');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true,
      });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Redis');
    redis = null;
  }
} else {
  logger.warn('⚠️  Redis is DISABLED. Call metering and job queues will not work.');
}

if (redis) {
  redis.on('connect', () => {
    logger.info('✅ Redis connected successfully');
  });

  redis.on('error', (err) => {
    logger.error({ err: err.message }, '❌ Redis connection error');
  });

  redis.on('close', () => {
    logger.warn('⚠️  Redis connection closed');
  });

  // Try to connect
  redis.connect().catch((err) => {
    logger.error({ err: err.message }, 'Failed to connect to Redis');
    logger.warn('Continuing without Redis. Call metering will not work.');
    redis = null; // Set to null on connection failure
  });

  process.on('SIGINT', async () => {
    if (redis) {
      await redis.quit();
      logger.info('Redis connection closed due to app termination');
    }
  });
}

export default redis;
