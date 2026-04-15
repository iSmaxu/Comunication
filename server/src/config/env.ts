// ============================================================
// SecureTeam — Configuración de variables de entorno
// Validación con Zod para asegurar que todo está configurado
// ============================================================

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Base de datos
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string(),

  // Servidor
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // SSO
  SSO_ISSUER_URL: z.string().url().optional(),
  SSO_CLIENT_ID: z.string().optional(),
  SSO_CLIENT_SECRET: z.string().optional(),
  SSO_REDIRECT_URI: z.string().url().optional(),
  SSO_LOGOUT_URI: z.string().url().optional(),

  // Seguridad
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),
  SESSION_MAX_AGE_DAYS: z.coerce.number().default(30),
});

function validateEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Variables de entorno inválidas:');
    for (const issue of parsed.error.issues) {
      console.error(`   ${issue.path.join('.')}: ${issue.message}`);
    }

    // En desarrollo, usar valores por defecto para SSO
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️  Modo desarrollo: usando valores por defecto');
      return envSchema.parse({
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || 'postgresql://secureteam_admin:SecureTeam2026!Dev@localhost:5432/secureteam',
        REDIS_URL: process.env.REDIS_URL || 'redis://:SecureTeamRedis2026!@localhost:6379',
        JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-key-change-in-production-must-be-at-least-32-chars!!',
      });
    }

    process.exit(1);
  }

  return parsed.data;
}

export const env = validateEnv();
export type Env = z.infer<typeof envSchema>;
