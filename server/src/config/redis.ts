// ============================================================
// SecureTeam — Configuración de Redis
// Usado para: sesiones, pub/sub de WebSocket, rate limiting
// ============================================================

import Redis from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true,
});

export const redisSub = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
});

export async function connectRedis(): Promise<void> {
  try {
    await redis.connect();
    await redisSub.connect();
    console.log('✅ Redis conectado');
  } catch (error) {
    console.error('❌ Error conectando a Redis:', error);
    // Redis es opcional en desarrollo
    if (env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      console.warn('⚠️  Continuando sin Redis en modo desarrollo');
    }
  }
}

export async function disconnectRedis(): Promise<void> {
  redis.disconnect();
  redisSub.disconnect();
  console.log('🔌 Redis desconectado');
}
