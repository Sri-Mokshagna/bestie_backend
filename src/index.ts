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

// Initialize jobs (only if Redis is available)
// import './jobs/callMetering'; // Disabled for now - enable when Redis is ready

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
      logger.info(`🚀 Server running on port ${port}`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🔗 Health check: http://localhost:${port}/healthz`);
      logger.info(`🌐 Network: http://192.168.0.106:${port}/healthz`);
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
