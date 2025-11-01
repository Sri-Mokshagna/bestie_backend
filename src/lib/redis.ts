import Redis from 'ioredis';
import { logger } from './logger';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false'; // Set to 'false' to disable

let redis: Redis | null = null;

if (REDIS_ENABLED) {
  redis = new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 3) {
        logger.warn('Redis connection failed after 3 retries. Disabling Redis.');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    lazyConnect: true, // Don't connect immediately
  });
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
  });

  process.on('SIGINT', async () => {
    if (redis) {
      await redis.quit();
      logger.info('Redis connection closed due to app termination');
    }
  });
}

export default redis;
