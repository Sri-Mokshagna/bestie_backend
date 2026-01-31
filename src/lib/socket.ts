import { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function setSocketIO(socketServer: SocketServer) {
  io = socketServer;
}

export function getSocketIO(): SocketServer | null {
  return io;
}


export function emitToUser(userId: string, event: string, data: any) {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return false;
  }

  console.log(`📤 Emitting '${event}' to user_${userId}`, data);

  // Check if user has any connected sockets
  const room = io.sockets.adapter.rooms.get(`user_${userId}`);
  const isConnected = room && room.size > 0;

  if (!isConnected) {
    console.warn(`⚠️ User ${userId} has no active socket connections - notification may not be received`);
  }

  // Emit to specific user's room
  io.to(`user_${userId}`).emit(event, data);

  return isConnected;
}

/**
 * Check if a user has any active socket connections
 */
export function isUserConnected(userId: string): boolean {
  if (!io) return false;
  const room = io.sockets.adapter.rooms.get(`user_${userId}`);
  return room ? room.size > 0 : false;
}

export function emitToRoom(roomId: string, event: string, data: any) {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }

  io.to(roomId).emit(event, data);
}
