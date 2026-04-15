// ============================================================
// SecureTeam — Rutas de Autenticación
// SSO corporativo + modo desarrollo con credenciales locales
// ============================================================

import { Router, Request, Response } from 'express';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { createSession, authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { generateSecureIdentity } from '../utils/identity.js';
import { ref, set } from 'firebase/database';
import { rtdb } from '../config/firebase.js';

const router = Router();

// -------------------------------------------------------
// POST /api/auth/login 
// Inicia sesión validando contra usuarios configurados
// -------------------------------------------------------
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, deviceInfo } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Se requiere email y password',
      });
      return;
    }

    // Cargar y parsear usuarios autorizados de .env
    const authorizedUsersStr = process.env.AUTHORIZED_USERS || '[]';
    let authorizedUsers: any[] = [];
    try {
      authorizedUsers = JSON.parse(authorizedUsersStr);
    } catch (e) {
      console.error('Error parseando AUTHORIZED_USERS', e);
    }

    // Buscar credenciales válidas
    const validUser = authorizedUsers.find((u) => u.email === email && u.password === password);

    if (!validUser) {
      res.status(401).json({
        success: false,
        error: 'Credenciales inválidas',
      });
      return;
    }

    // Generar un ID único basado en el correo para la base de datos local
    const ssoSubjectId = `local_${email}`;

    // Buscar o crear usuario
    let user = await prisma.user.findUnique({
      where: { ssoSubjectId },
    });

    if (!user) {
      let identity = generateSecureIdentity();
      let isUnique = false;
      while (!isUnique) {
        const existing = await prisma.user.findFirst({
           where: { OR: [{ masterId: identity.masterId }, { publicCode: identity.publicCode }] }
        });
        if (existing) {
          identity = generateSecureIdentity();
        } else {
          isUnique = true;
        }
      }

      user = await prisma.user.create({
        data: {
          email,
          displayName: validUser.name || email.split('@')[0],
          ssoSubjectId,
          role: validUser.role || 'USER',
          masterId: identity.masterId,
          publicCode: identity.publicCode,
          confirmPin: identity.confirmPin
        },
      });

      // Guardar en Firebase RTDB
      try {
        await set(ref(rtdb, `identities/publicCode_${identity.publicCode}`), {
          masterId: identity.masterId,
          userId: user.id,
          confirmPin: identity.confirmPin
        });
      } catch (err) {
        console.error('Error guardando identidad en Firebase:', err);
      }

      console.log(`👤 Nuevo usuario creado: ${user.displayName} (${user.role})`);
    }

    if (!user.isActive) {
      res.status(403).json({
        success: false,
        error: 'Tu cuenta ha sido desactivada. Contacta al administrador.',
      });
      return;
    }

    // Crear sesión
    const { token, sessionId } = await createSession(
      user.id,
      user.email,
      user.role,
      deviceInfo || 'Unknown Device'
    );

    // Actualizar último acceso
    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    });

    res.json({
      success: true,
      data: {
        token,
        sessionId,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          role: user.role,
          publicIdentityKey: user.publicIdentityKey,
          publicCode: user.publicCode,
        },
      },
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al iniciar sesión',
    });
  }
});



// -------------------------------------------------------
// POST /api/auth/logout — Cerrar sesión actual
// -------------------------------------------------------
router.post(
  '/logout',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      await prisma.session.update({
        where: { id: req.user!.sessionId },
        data: { isRevoked: true },
      });

      res.json({
        success: true,
        message: 'Sesión cerrada correctamente',
      });
    } catch (error) {
      console.error('Error en logout:', error);
      res.status(500).json({
        success: false,
        error: 'Error al cerrar sesión',
      });
    }
  }
);

// -------------------------------------------------------
// GET /api/auth/me — Obtener perfil del usuario actual
// -------------------------------------------------------
router.get(
  '/me',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          publicIdentityKey: true,
          publicCode: true,
          isActive: true,
          createdAt: true,
          lastSeenAt: true,
        },
      });

      res.json({
        success: true,
        data: user,
      });
    } catch (error) {
      console.error('Error obteniendo perfil:', error);
      res.status(500).json({
        success: false,
        error: 'Error al obtener perfil',
      });
    }
  }
);

// -------------------------------------------------------
// PUT /api/auth/keys — Actualizar claves públicas del usuario
// Se llama cuando el usuario genera sus claves de cifrado
// -------------------------------------------------------
router.put(
  '/keys',
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { publicIdentityKey, signedPrekey, signedPrekeySignature, oneTimePrekeys } = req.body;

      if (!publicIdentityKey || !signedPrekey || !signedPrekeySignature) {
        res.status(400).json({
          success: false,
          error: 'Se requieren publicIdentityKey, signedPrekey y signedPrekeySignature',
        });
        return;
      }

      // Actualizar claves del usuario
      await prisma.user.update({
        where: { id: req.user!.id },
        data: {
          publicIdentityKey,
          signedPrekey,
          signedPrekeySignature,
        },
      });

      // Registrar one-time prekeys si se proporcionan
      if (oneTimePrekeys && Array.isArray(oneTimePrekeys)) {
        await prisma.preKeyBundle.createMany({
          data: oneTimePrekeys.map((key: string) => ({
            userId: req.user!.id,
            oneTimePrekeyPublic: key,
          })),
        });
      }

      // Crear registro de verificación de clave
      const fingerprint = crypto
        .createHash('sha256')
        .update(publicIdentityKey)
        .digest('hex')
        .slice(0, 40);

      // Marcar verificaciones anteriores como no actuales
      await prisma.keyVerification.updateMany({
        where: { userId: req.user!.id, isCurrent: true },
        data: { isCurrent: false },
      });

      await prisma.keyVerification.create({
        data: {
          userId: req.user!.id,
          identityKeyFingerprint: fingerprint,
          isCurrent: true,
        },
      });

      res.json({
        success: true,
        message: 'Claves actualizadas correctamente',
        data: { fingerprint },
      });
    } catch (error) {
      console.error('Error actualizando claves:', error);
      res.status(500).json({
        success: false,
        error: 'Error al actualizar claves',
      });
    }
  }
);

export default router;
