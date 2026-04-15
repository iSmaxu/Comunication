// ============================================================
// SecureTeam — Punto de Entrada del Servidor
// Express + Socket.IO + PostgreSQL + Redis
// ============================================================

import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { setupWebSocket } from './services/websocket.js';

// Rutas
import authRoutes from './routes/auth.js';
import conversationRoutes from './routes/conversations.js';
import messageRoutes from './routes/messages.js';
import adminRoutes from './routes/admin.js';
import userRoutes from './routes/users.js';
import handshakeRoutes from './routes/handshakes.js';

async function main() {
  // -------------------------------------------------------
  // Crear aplicación Express
  // -------------------------------------------------------
  const app = express();
  const httpServer = createServer(app);

  // -------------------------------------------------------
  // Middleware global
  // -------------------------------------------------------
  app.use(helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  }));
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      
      // Parse allowed origins from env (comma-separated)
      const allowedOrigins = env.CORS_ORIGIN.split(',').map(o => o.trim());
      
      // Always allow Capacitor/Ionic/localhost origins
      const alwaysAllow = [
        'capacitor://localhost',
        'ionic://localhost',
        'http://localhost',
        'http://localhost:5173',
        'http://localhost:5174',
      ];
      
      const all = [...allowedOrigins, ...alwaysAllow];
      
      if (all.some(allowed => origin.startsWith(allowed) || origin === allowed)) {
        return callback(null, true);
      }
      
      // In development, allow everything
      if (env.NODE_ENV === 'development') {
        return callback(null, true);
      }
      
      callback(new Error('CORS not allowed'));
    },
    credentials: true,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  if (env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined'));
  }

  // -------------------------------------------------------
  // Health check
  // -------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'SecureTeam API',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });

  // -------------------------------------------------------
  // Registrar rutas
  // -------------------------------------------------------
  app.use('/api/auth', authRoutes);
  app.use('/api/conversations', conversationRoutes);
  app.use('/api/messages', messageRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/handshakes', handshakeRoutes);

  // -------------------------------------------------------
  // Manejo de errores global
  // -------------------------------------------------------
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('❌ Error no manejado:', err);
    res.status(500).json({
      success: false,
      error: env.NODE_ENV === 'development'
        ? err.message
        : 'Error interno del servidor',
    });
  });

  // 404
  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Ruta no encontrada',
    });
  });

  // -------------------------------------------------------
  // Conectar servicios
  // -------------------------------------------------------
  await connectDatabase();

  try {
    await connectRedis();
  } catch {
    console.warn('⚠️ Redis no disponible, continuando sin cache');
  }

  // -------------------------------------------------------
  // Configurar WebSocket
  // -------------------------------------------------------
  const io = setupWebSocket(httpServer);

  // -------------------------------------------------------
  // Iniciar servidor
  // -------------------------------------------------------
  httpServer.listen(env.PORT, () => {
    console.log('');
    console.log('='.repeat(50));
    console.log('🔒 SecureTeam Server');
    console.log('='.repeat(50));
    console.log(`📡 API:       http://localhost:${env.PORT}/api`);
    console.log(`🔌 WebSocket: ws://localhost:${env.PORT}`);
    console.log(`🌍 Entorno:   ${env.NODE_ENV}`);
    console.log(`🗄️  Base datos: PostgreSQL conectada`);
    console.log('='.repeat(50));
    console.log('');
  });

  // -------------------------------------------------------
  // Graceful shutdown
  // -------------------------------------------------------
  const shutdown = async (signal: string) => {
    console.log(`\n📴 Recibida señal ${signal}. Cerrando...`);
    io.close();
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('❌ Error fatal al iniciar servidor:', error);
  process.exit(1);
});
