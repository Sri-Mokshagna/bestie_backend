import { Router } from 'express';
import { connectDB } from '../lib/db';

const router = Router();

router.get('/health', async (_req, res) => {
  const health = {
    uptime: process.uptime(),
    timestamp: Date.now(),
    status: 'OK',
    services: {
      database: 'unknown',
    },
  };

  try {
    // Check MongoDB connection
    await connectDB();
    health.services.database = 'connected';
  } catch (error) {
    health.services.database = 'disconnected';
    health.status = 'DEGRADED';
  }

  const statusCode = health.status === 'OK' ? 200 : 503;
  res.status(statusCode).json(health);
});

export default router;
