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
    return;
  }
  
  console.log(`📤 Emitting '${event}' to user_${userId}`, data);
  
  // Emit to specific user's room
  io.to(`user_${userId}`).emit(event, data);
}

export function emitToRoom(roomId: string, event: string, data: any) {
  if (!io) {
    console.warn('Socket.IO not initialized');
    return;
  }
  
  io.to(roomId).emit(event, data);
}
