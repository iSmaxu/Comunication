// ============================================================
// SecureTeam — Servicio WebSocket
// Maneja mensajería en tiempo real, indicadores de escritura,
// confirmaciones de lectura, y cierre de sesión remoto.
// ============================================================

import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  sessionId?: string;
  userRole?: string;
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
}

// Mapa de usuarios conectados: userId -> Set de socketIds
const connectedUsers = new Map<string, Set<string>>();

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingInterval: 25000,
    pingTimeout: 10000,
  });

  // -------------------------------------------------------
  // Middleware de autenticación para WebSocket
  // -------------------------------------------------------
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Token de autenticación requerido'));
      }

      // Verificar JWT
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

      // Verificar sesión activa
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const session = await prisma.session.findFirst({
        where: {
          id: payload.sessionId,
          tokenHash,
          isRevoked: false,
          expiresAt: { gt: new Date() },
        },
      });

      if (!session) {
        return next(new Error('Sesión revocada o expirada'));
      }

      socket.userId = payload.userId;
      socket.sessionId = payload.sessionId;
      socket.userRole = payload.role;

      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  // -------------------------------------------------------
  // Manejo de conexiones
  // -------------------------------------------------------
  io.on('connection', async (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const sessionId = socket.sessionId!;

    console.log(`🟢 Usuario conectado: ${userId} (socket: ${socket.id})`);

    // Registrar conexión
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId)!.add(socket.id);

    // Unirse a salas de conversaciones
    const memberships = await prisma.conversationMember.findMany({
      where: { userId },
      select: { conversationId: true },
    });

    for (const m of memberships) {
      socket.join(`conversation:${m.conversationId}`);
    }

    // Notificar online
    socket.broadcast.emit('user:online', { userId });

    // Actualizar última vez visto
    await prisma.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });

    // -------------------------------------------------------
    // Enviar mensaje en tiempo real
    // -------------------------------------------------------
    socket.on('message:send', async (data) => {
      try {
        const {
          conversationId,
          encryptedContent,
          iv,
          senderEphemeralPublicKey,
          replyToId,
          tempId,
        } = data;

        // Verificar membresía
        const membership = await prisma.conversationMember.findFirst({
          where: { conversationId, userId, canWrite: true },
        });

        if (!membership) {
          socket.emit('message:error', {
            tempId,
            error: 'No tienes permiso de escritura',
          });
          return;
        }

        // Verificar auto-destrucción
        let autoDestructAt: Date | null = null;
        const agreement = await prisma.autoDestructAgreement.findFirst({
          where: { conversationId, isActive: true },
        });
        if (agreement) {
          autoDestructAt = new Date(Date.now() + agreement.minutes * 60 * 1000);
        }

        // Guardar mensaje
        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: userId,
            encryptedContent,
            iv,
            senderEphemeralPublicKey: senderEphemeralPublicKey || null,
            replyToId: replyToId || null,
            autoDestructAt,
          },
          include: {
            sender: {
              select: {
                id: true,
                displayName: true,
                role: true,
                isActive: true,
              },
            },
            replyTo: {
              select: {
                id: true,
                senderId: true,
                isDeleted: true,
                createdAt: true,
                sender: { select: { displayName: true } },
              },
            },
          },
        });

        // Confirmar al emisor
        socket.emit('message:sent', { tempId, message });

        // Enviar a toda la sala (excepto emisor)
        socket.to(`conversation:${conversationId}`).emit('message:new', { message });

        // Crear receipts de "entregado" para usuarios online en la sala
        const roomSockets = await io.in(`conversation:${conversationId}`).fetchSockets();
        const onlineUserIds = new Set<string>();
        for (const s of roomSockets) {
          const authSocket = s as unknown as AuthenticatedSocket;
          if (authSocket.userId && authSocket.userId !== userId) {
            onlineUserIds.add(authSocket.userId);
          }
        }

        if (onlineUserIds.size > 0) {
          await prisma.messageReceipt.createMany({
            data: [...onlineUserIds].map((uid) => ({
              messageId: message.id,
              userId: uid,
              deliveredAt: new Date(),
            })),
            skipDuplicates: true,
          });
        }
      } catch (error) {
        console.error('Error en message:send:', error);
        socket.emit('message:error', { error: 'Error al enviar mensaje' });
      }
    });

    // -------------------------------------------------------
    // Borrar mensaje para todos
    // -------------------------------------------------------
    socket.on('message:delete', async (data) => {
      try {
        const { messageId, conversationId } = data;

        const message = await prisma.message.findFirst({
          where: { id: messageId, senderId: userId },
        });

        if (!message && socket.userRole !== 'ADMIN') {
          socket.emit('message:error', { error: 'No puedes borrar este mensaje' });
          return;
        }

        await prisma.message.update({
          where: { id: messageId },
          data: {
            isDeleted: true,
            deletedForAll: true,
            encryptedContent: '[ELIMINADO]',
            iv: '',
          },
        });

        io.to(`conversation:${conversationId}`).emit('message:deleted', { messageId, conversationId });
      } catch (error) {
        console.error('Error en message:delete:', error);
      }
    });

    // -------------------------------------------------------
    // Indicador de escritura (solo admins pueden ver)
    // -------------------------------------------------------
    socket.on('typing:start', (data) => {
      const { conversationId } = data;
      // Emitir a la sala pero solo los admins lo mostrarán en el frontend
      socket.to(`conversation:${conversationId}`).emit('typing:user', {
        userId,
        conversationId,
        isTyping: true,
      });
    });

    socket.on('typing:stop', (data) => {
      const { conversationId } = data;
      socket.to(`conversation:${conversationId}`).emit('typing:user', {
        userId,
        conversationId,
        isTyping: false,
      });
    });

    // -------------------------------------------------------
    // Mensaje leído (solo admins pueden ver las confirmaciones)
    // -------------------------------------------------------
    socket.on('message:read', async (data) => {
      try {
        const { messageId, conversationId } = data;

        await prisma.messageReceipt.upsert({
          where: {
            messageId_userId: { messageId, userId },
          },
          create: {
            messageId,
            userId,
            deliveredAt: new Date(),
            readAt: new Date(),
          },
          update: {
            readAt: new Date(),
          },
        });

        // Emitir confirmación (el frontend de admins lo usará)
        socket.to(`conversation:${conversationId}`).emit('message:read_ack', {
          messageId,
          userId,
          readAt: new Date(),
        });
      } catch (error) {
        console.error('Error en message:read:', error);
      }
    });

    // -------------------------------------------------------
    // Unirse a nueva conversación (cuando te agregan)
    // -------------------------------------------------------
    socket.on('conversation:join', (data) => {
      socket.join(`conversation:${data.conversationId}`);
    });

    // -------------------------------------------------------
    // Desconexión
    // -------------------------------------------------------
    socket.on('disconnect', async () => {
      console.log(`🔴 Usuario desconectado: ${userId} (socket: ${socket.id})`);

      const userSockets = connectedUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          connectedUsers.delete(userId);
          // Notificar offline solo si no quedan conexiones
          socket.broadcast.emit('user:offline', { userId });

          await prisma.user.update({
            where: { id: userId },
            data: { lastSeenAt: new Date() },
          });
        }
      }
    });
  });

  // -------------------------------------------------------
  // Función para forzar cierre de sesión (llamada desde admin)
  // -------------------------------------------------------
  (io as any).forceLogout = async (userId: string, sessionId?: string) => {
    const userSockets = connectedUsers.get(userId);
    if (userSockets) {
      for (const socketId of userSockets) {
        const socket = io.sockets.sockets.get(socketId) as AuthenticatedSocket;
        if (socket) {
          if (!sessionId || socket.sessionId === sessionId) {
            socket.emit('session:force_logout', {
              message: 'Tu sesión ha sido cerrada por un administrador.',
            });
            socket.disconnect(true);
          }
        }
      }
    }
  };

  // -------------------------------------------------------
  // Limpieza de mensajes auto-destruibles (cada minuto)
  // -------------------------------------------------------
  setInterval(async () => {
    try {
      const expired = await prisma.message.findMany({
        where: {
          autoDestructAt: { lte: new Date() },
          isDeleted: false,
        },
        select: { id: true, conversationId: true },
      });

      if (expired.length > 0) {
        await prisma.message.updateMany({
          where: {
            id: { in: expired.map((m: any) => m.id) },
          },
          data: {
            isDeleted: true,
            deletedForAll: true,
            encryptedContent: '[AUTO-DESTRUIDO]',
            iv: '',
          },
        });

        // Notificar a los clientes
        for (const msg of expired) {
          io.to(`conversation:${msg.conversationId}`).emit('message:deleted', {
            messageId: msg.id,
            conversationId: msg.conversationId,
            autoDestruct: true,
          });
        }

        console.log(`🗑️ ${expired.length} mensaje(s) auto-destruido(s)`);
      }
    } catch (error) {
      console.error('Error en limpieza de mensajes:', error);
    }
  }, 60000); // Cada 60 segundos

  console.log('🔌 WebSocket configurado');
  return io;
}

export function getConnectedUsers(): Map<string, Set<string>> {
  return connectedUsers;
}
