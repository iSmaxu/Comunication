// ============================================================
// SecureTeam — Cliente WebSocket (Socket.IO)
// Maneja conexión en tiempo real con el servidor
// ============================================================

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(token: string): Socket {
  if (socket?.connected) {
    return socket;
  }

  socket = io('/', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log('🟢 WebSocket conectado');
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔴 WebSocket desconectado: ${reason}`);
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Error de conexión WebSocket:', error.message);
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log('🔌 WebSocket desconectado manualmente');
  }
}
