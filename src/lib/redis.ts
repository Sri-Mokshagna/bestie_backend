import Redis from 'ioredis';
import { logger } from './logger';

// Temporarily disabled Redis for testing call sync
const REDIS_ENABLED = false; // process.env.REDIS_ENABLED !== 'false';
const REDIS_URL = process.env.REDIS_URL;

let redis: Redis | null = null;
let bullmqRedis: Redis | null = null;

if (REDIS_ENABLED) {
  try {
    if (REDIS_URL) {
      // Production: Use REDIS_URL (from Render Redis service)
      // Regular Redis connection with timeouts
      redis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 3,
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
        // Add keepAlive settings for better connection stability
        keepAlive: 30000,
        family: 4, // Force IPv4
      });

      // Separate BullMQ Redis connection with null maxRetriesPerRequest
      bullmqRedis = new Redis(REDIS_URL, {
        maxRetriesPerRequest: null, // Required for BullMQ blocking operations
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('BullMQ Redis connection failed after 3 retries.');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true,
        connectTimeout: 10000,
        // TLS settings for Render Redis
        tls: REDIS_URL.startsWith('rediss://') ? {} : undefined,
        keepAlive: 30000,
        family: 4,
      });
    } else {
      // Development: Use individual host/port
      const redisHost = process.env.REDIS_HOST || 'localhost';
      const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

      // Regular Redis connection with timeouts
      redis = new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Redis connection failed after 3 retries. Disabling Redis.');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true,
        commandTimeout: 5000,
        keepAlive: 30000,
        family: 4,
      });

      // Separate BullMQ Redis connection
      bullmqRedis = new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: null, // Required for BullMQ blocking operations
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('BullMQ Redis connection failed after 3 retries.');
            return null;
          }
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        lazyConnect: true,
        keepAlive: 30000,
        family: 4,
      });
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize Redis');
    redis = null;
    bullmqRedis = null;
  }
} else {
  logger.warn('⚠️  Redis is DISABLED. Call metering and job queues will not work.');
}

// Setup regular Redis connection
if (redis) {
  redis.on('connect', () => {
    logger.info('✅ Redis connected successfully');
  });

  redis.on('error', (err) => {
    logger.error({ err: err.message }, '❌ Redis connection error');

    // If we get repeated timeout errors, disable Redis to prevent infinite loops
    if (err.message.includes('Command timed out')) {
      logger.error('Redis command timeouts detected. Consider disabling Redis or checking connection.');
    }
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
}

// Setup BullMQ Redis connection
if (bullmqRedis) {
  bullmqRedis.on('connect', () => {
    logger.info('✅ BullMQ Redis connected successfully');
  });

  bullmqRedis.on('error', (err) => {
    logger.error({ err: err.message }, '❌ BullMQ Redis connection error');
  });

  bullmqRedis.on('close', () => {
    logger.warn('⚠️  BullMQ Redis connection closed');
  });

  // Try to connect
  bullmqRedis.connect().catch((err) => {
    logger.error({ err: err.message }, 'Failed to connect to BullMQ Redis');
    logger.warn('Continuing without BullMQ Redis. Call metering will not work.');
    bullmqRedis = null; // Set to null on connection failure
  });
}

// Cleanup on app termination
process.on('SIGINT', async () => {
  if (redis) {
    await redis.quit();
    logger.info('Redis connection closed due to app termination');
  }
  if (bullmqRedis) {
    await bullmqRedis.quit();
    logger.info('BullMQ Redis connection closed due to app termination');
  }
});

export default redis;
export { bullmqRedis };
