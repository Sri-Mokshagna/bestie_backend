import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../lib/logger';

/**
 * Service to manage socket timeouts.
 * Automatically disconnects sockets after 24 hours of connection.
 * 
 * Calls continue to work via ZegoCloud, this only affects real-time events like:
 * - Incoming call notifications
 * - Chat messages (falls back to HTTP)
 * - Presence updates
 */
class SocketTimeoutService {
    private socketTimeouts = new Map<string, NodeJS.Timeout>();
    private readonly TIMEOUT_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    /**
     * Register a socket for timeout tracking
     * @param socket Socket.IO socket instance
     */
    registerSocket(socket: Socket): void {
        const timeoutId = setTimeout(() => {
            logger.info(
                {
                    socketId: socket.id,
                    userId: (socket as any).userId,
                    connectedAt: new Date(Date.now() - this.TIMEOUT_DURATION).toISOString(),
                    reason: '24_hour_timeout',
                },
                '🕐 Auto-disconnecting socket after 24 hours'
            );

            // Disconnect socket gracefully
            socket.disconnect(true);

            // Clean up timeout reference
            this.socketTimeouts.delete(socket.id);
        }, this.TIMEOUT_DURATION);

        // Store timeout reference
        this.socketTimeouts.set(socket.id, timeoutId);

        logger.debug(
            {
                socketId: socket.id,
                userId: (socket as any).userId,
                disconnectAt: new Date(Date.now() + this.TIMEOUT_DURATION).toISOString(),
            },
            '⏰ Socket timeout registered (24 hours)'
        );
    }

    /**
     * Clear timeout for a socket (called when socket disconnects before timeout)
     * @param socketId Socket ID
     */
    clearTimeout(socketId: string): void {
        const timeoutId = this.socketTimeouts.get(socketId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.socketTimeouts.delete(socketId);
            logger.debug({ socketId }, '✅ Socket timeout cleared');
        }
    }

    /**
     * Get active socket count
     */
    getActiveSocketCount(): number {
        return this.socketTimeouts.size;
    }

    /**
     * Initialize the service with Socket.IO server
     * @param io Socket.IO server instance
     */
    initialize(io: SocketIOServer): void {
        io.on('connection', (socket: Socket) => {
            // Register socket for 24-hour timeout
            this.registerSocket(socket);

            // Clean up timeout when socket disconnects
            socket.on('disconnect', () => {
                this.clearTimeout(socket.id);
            });
        });

        logger.info('✅ Socket timeout service initialized (24-hour auto-disconnect)');
    }
}

export const socketTimeoutService = new SocketTimeoutService();
