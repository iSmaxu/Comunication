// ============================================================
// SecureTeam — Middleware de Autenticación
// Verifica JWT en cada request protegida y comprueba que
// la sesión no ha sido revocada (cierre remoto por admin)
// ============================================================

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import crypto from 'crypto';

// Extender Request de Express para incluir usuario autenticado
export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    sessionId: string;
  };
}

interface JwtPayload {
  userId: string;
  email: string;
  role: string;
  sessionId: string;
  iat: number;
  exp: number;
}

/**
 * Middleware principal de autenticación.
 * - Extrae el JWT del header Authorization (Bearer token)
 * - Verifica la firma
 * - Comprueba que la sesión existe y no está revocada
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Extraer token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'No se proporcionó token de autenticación',
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    // Verificar JWT
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      res.status(401).json({
        success: false,
        error: 'Token inválido o expirado',
      });
      return;
    }

    // Verificar que la sesión no ha sido revocada
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
      res.status(401).json({
        success: false,
        error: 'Sesión revocada o expirada. Inicia sesión nuevamente.',
      });
      return;
    }

    // Verificar que el usuario existe y está activo
    const user = await prisma.user.findUnique({
      where: { id: payload.userId, isActive: true },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Usuario no encontrado o desactivado',
      });
      return;
    }

    // Actualizar último acceso
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    // Adjuntar usuario al request
    req.user = {
      id: payload.userId,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sessionId,
    };

    next();
  } catch (error) {
    console.error('Error en autenticación:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno de autenticación',
    });
  }
}

/**
 * Genera un JWT y crea una sesión en la base de datos.
 */
export async function createSession(
  userId: string,
  email: string,
  role: string,
  deviceInfo: string
): Promise<{ token: string; sessionId: string }> {
  const sessionId = crypto.randomUUID();

  const token = jwt.sign(
    { userId, email, role, sessionId },
    env.JWT_SECRET as string,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  );

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.SESSION_MAX_AGE_DAYS);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      deviceInfo,
      tokenHash,
      expiresAt,
    },
  });

  return { token, sessionId };
}
