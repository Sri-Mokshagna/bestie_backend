import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { connectDB } from './lib/db';
import { initializeFirebase } from './lib/firebase';
import { logger } from './lib/logger';
import { errorHandler, notFound } from './middleware/errorHandler';
import { initializeChatSocket } from './modules/chat/chat.socket';
import { setSocketIO } from './lib/socket';

// Import routes
import authRoutes from './modules/auth/auth.routes';
import walletRoutes from './modules/wallet/wallet.routes';
import callRoutes from './modules/calls/call.routes';
import chatRoutes from './modules/chat/chat.routes';
import responderRoutes from './modules/responder/responder.routes';
import uploadRoutes from './modules/upload/upload.routes';
import notificationRoutes from './modules/notifications/notification.routes';
import payoutRoutes from './modules/responder/payout.routes';
import coinConfigRoutes from './modules/admin/coinConfig.routes';
import adminRoutes from './modules/admin/admin.routes';
import promotionRoutes from './modules/admin/promotion.routes';
import profileRoutes from './modules/profile/profile.routes';
import supportRoutes from './modules/support/support.routes';
import admobRoutes from './modules/admob/admob.routes';
import healthRoutes from './routes/health';
import paymentRoutes from './modules/payments/payment.routes';
import redemptionRoutes from './modules/redemption/redemption.routes';
import commissionRoutes from './modules/admin/commission.routes';
import paymentRedirectRoutes from './routes/payment-redirect';

const app = express();
const httpServer = createServer(app);

// Configure server for multiple connections
httpServer.keepAliveTimeout = 65000; // 65 seconds
httpServer.headersTimeout = 66000; // 66 seconds (slightly more than keepAlive)

const io = new SocketServer(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

const PORT = process.env.PORT || 3000;

// Trust proxy - Required for Render.com and rate limiting
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Health check
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/chats', chatRoutes);
app.use('/api/responders', responderRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin/coin-config', coinConfigRoutes);
app.use('/api/admin/promotions', promotionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admob', admobRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/redemptions', redemptionRoutes);
app.use('/api/admin/commission', commissionRoutes);
app.use('/payment', paymentRedirectRoutes);
app.use('/api', healthRoutes);

// Initialize Socket.IO
setSocketIO(io);
initializeChatSocket(io);

// Error handlers
app.use(notFound);
app.use(errorHandler);

// Start server
async function start() {
  try {
    // Connect to MongoDB
    await connectDB();

    // Initialize Firebase
    initializeFirebase();

    // Start server - Listen on all network interfaces (0.0.0.0)
    const port = typeof PORT === 'string' ? parseInt(PORT) : PORT;
    httpServer.listen(port, '0.0.0.0', () => {
      const isProduction = process.env.NODE_ENV === 'production';
      const renderUrl = process.env.RENDER_EXTERNAL_URL;

      logger.info(`🚀 Server running on port ${port}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);

      if (isProduction && renderUrl) {
        logger.info(`🔗 Health check: ${renderUrl}/healthz`);
        logger.info(`🌐 External URL: ${renderUrl}`);
      } else {
        logger.info(`🔗 Health check: http://localhost:${port}/healthz`);
        logger.info(`🌐 Network: http://192.168.0.106:${port}/healthz`);
      }
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error}`);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    logger.info('HTTP server closed');
  });
});
