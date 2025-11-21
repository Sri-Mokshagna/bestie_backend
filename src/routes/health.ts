import { Router } from 'express';
import redis from '../lib/redis';
import { logger } from '../lib/logger';

const router = Router();

router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      redis: 'unknown',
      database: 'ok', // Assuming MongoDB is working if server is running
    },
  };

  // Check Redis connection
  if (redis) {
    try {
      await redis.ping();
      health.services.redis = 'ok';
    } catch (error) {
      health.services.redis = 'error';
      health.status = 'degraded';
      logger.warn({ error }, 'Redis health check failed');
    }
  } else {
    health.services.redis = 'disabled';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

router.get('/redis-status', async (req, res) => {
  if (!redis) {
    return res.json({
      status: 'disabled',
      message: 'Redis is disabled or not configured',
    });
  }

  try {
    const info = await redis.info('server');
    const ping = await redis.ping();
    
    res.json({
      status: 'connected',
      ping,
      server_info: info.split('\r\n').slice(0, 5), // First 5 lines of server info
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
