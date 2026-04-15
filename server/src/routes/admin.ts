// ============================================================
// SecureTeam — Panel de Administración
// Cierre de sesión remoto + verificación de integridad de claves
// ============================================================

import { Router, Response } from 'express';
import { prisma } from '../config/database.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { adminOnly } from '../middleware/roles.js';
import bcrypt from 'bcryptjs';
import { generateSecureIdentity } from '../utils/identity.js';
import { ref, set } from 'firebase/database';
import { rtdb } from '../config/firebase.js';

const router = Router();

// Todas las rutas requieren autenticación + rol admin
router.use(authMiddleware);
router.use(adminOnly);

// -------------------------------------------------------
// POST /api/admin/users/register — Registrar un nuevo usuario (User normal)
// -------------------------------------------------------
router.post('/users/register', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { email, password, displayName } = req.body;

    if (!email || !password || !displayName) {
      res.status(400).json({ success: false, error: 'Faltan campos requeridos' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ success: false, error: 'El correo ya está registrado' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const ssoSubjectId = `local_${email}`;

    let identity = generateSecureIdentity();
    let isUnique = false;
    while (!isUnique) {
      const existingKey = await prisma.user.findFirst({
         where: { OR: [{ masterId: identity.masterId }, { publicCode: identity.publicCode }] }
      });
      if (existingKey) {
        identity = generateSecureIdentity();
      } else {
        isUnique = true;
      }
    }

    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        ssoSubjectId,
        passwordHash,
        role: 'USER',
        masterId: identity.masterId,
        publicCode: identity.publicCode,
        confirmPin: identity.confirmPin
      },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true }
    });

    try {
      await set(ref(rtdb, `identities/publicCode_${identity.publicCode}`), {
        masterId: identity.masterId,
        userId: user.id,
        confirmPin: identity.confirmPin
      });
    } catch (err) {
      console.error('Error guardando identidad en Firebase RTDB:', err);
    }

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Error registrando usuario:', error);
    res.status(500).json({ success: false, error: 'Error interno al crear usuario' });
  }
});

// -------------------------------------------------------
// GET /api/admin/users — Listar todos los usuarios
// -------------------------------------------------------
router.get('/users', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
        lastSeenAt: true,
        publicIdentityKey: true,
        _count: {
          select: {
            sessions: { where: { isRevoked: false, expiresAt: { gt: new Date() } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({ success: false, error: 'Error al listar usuarios' });
  }
});

// -------------------------------------------------------
// GET /api/admin/users/:userId/sessions — Sesiones activas de un usuario
// -------------------------------------------------------
router.get(
  '/users/:userId/sessions',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const sessions = await prisma.session.findMany({
        where: {
          userId: req.params.userId as string,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          deviceInfo: true,
          isRevoked: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: sessions,
      });
    } catch (error) {
      console.error('Error listando sesiones:', error);
      res.status(500).json({ success: false, error: 'Error al listar sesiones' });
    }
  }
);

// -------------------------------------------------------
// POST /api/admin/sessions/revoke — Revocar sesión remota
// El usuario será desconectado forzosamente via WebSocket
// -------------------------------------------------------
router.post(
  '/sessions/revoke',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { sessionId, userId } = req.body;

      if (!sessionId || !userId) {
        res.status(400).json({
          success: false,
          error: 'Se requiere sessionId y userId',
        });
        return;
      }

      // Verificar que la sesión pertenece al usuario indicado
      const session = await prisma.session.findFirst({
        where: {
          id: sessionId,
          userId,
        },
      });

      if (!session) {
        res.status(404).json({
          success: false,
          error: 'Sesión no encontrada',
        });
        return;
      }

      if (session.isRevoked) {
        res.json({
          success: true,
          message: 'La sesión ya estaba revocada',
        });
        return;
      }

      await prisma.session.update({
        where: { id: sessionId },
        data: { isRevoked: true },
      });

      // TODO: Emitir evento WebSocket FORCE_LOGOUT al usuario

      res.json({
        success: true,
        message: `Sesión revocada correctamente. El dispositivo "${session.deviceInfo}" será desconectado.`,
      });
    } catch (error) {
      console.error('Error revocando sesión:', error);
      res.status(500).json({ success: false, error: 'Error al revocar sesión' });
    }
  }
);

// -------------------------------------------------------
// POST /api/admin/sessions/revoke-all — Revocar TODAS las sesiones de un usuario
// Útil cuando un usuario pierde su dispositivo
// -------------------------------------------------------
router.post(
  '/sessions/revoke-all',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { userId } = req.body;

      if (!userId) {
        res.status(400).json({
          success: false,
          error: 'Se requiere userId',
        });
        return;
      }

      const result = await prisma.session.updateMany({
        where: {
          userId,
          isRevoked: false,
        },
        data: { isRevoked: true },
      });

      // TODO: Emitir evento WebSocket FORCE_LOGOUT al usuario

      res.json({
        success: true,
        message: `${result.count} sesión(es) revocada(s) correctamente`,
      });
    } catch (error) {
      console.error('Error revocando todas las sesiones:', error);
      res.status(500).json({ success: false, error: 'Error al revocar sesiones' });
    }
  }
);

// -------------------------------------------------------
// PUT /api/admin/users/:userId/toggle-active — Activar/desactivar usuario
// -------------------------------------------------------
router.put(
  '/users/:userId/toggle-active',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.userId as string },
      });

      if (!user) {
        res.status(404).json({
          success: false,
          error: 'Usuario no encontrado',
        });
        return;
      }

      // No permitir desactivarse a sí mismo
      if (user.id === req.user!.id) {
        res.status(400).json({
          success: false,
          error: 'No puedes desactivarte a ti mismo',
        });
        return;
      }

      const updated = await prisma.user.update({
        where: { id: req.params.userId as string },
        data: { isActive: !user.isActive },
      });

      // Si se desactiva, revocar todas las sesiones
      if (!updated.isActive) {
        await prisma.session.updateMany({
          where: { userId: user.id, isRevoked: false },
          data: { isRevoked: true },
        });
      }

      res.json({
        success: true,
        message: updated.isActive
          ? `Usuario "${user.displayName}" activado`
          : `Usuario "${user.displayName}" desactivado y todas sus sesiones revocadas`,
        data: { isActive: updated.isActive },
      });
    } catch (error) {
      console.error('Error toggling usuario:', error);
      res.status(500).json({ success: false, error: 'Error al cambiar estado del usuario' });
    }
  }
);

// -------------------------------------------------------
// GET /api/admin/key-verification — Auditoría de integridad de claves
// Verifica que ninguna clave de identidad ha sido modificada
// -------------------------------------------------------
router.get(
  '/key-verification',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const users = await prisma.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          displayName: true,
          publicIdentityKey: true,
          keyVerifications: {
            where: { isCurrent: true },
            take: 1,
          },
        },
      });

      const verificationResults = users.map((user: any) => {
        const currentVerification = user.keyVerifications[0];
        let status: 'verified' | 'changed' | 'no_keys';

        if (!user.publicIdentityKey) {
          status = 'no_keys';
        } else if (!currentVerification) {
          status = 'changed';
        } else {
          // Recalcular fingerprint y comparar
          const crypto = require('crypto');
          const currentFingerprint = crypto
            .createHash('sha256')
            .update(user.publicIdentityKey)
            .digest('hex')
            .slice(0, 40);

          status =
            currentFingerprint === currentVerification.identityKeyFingerprint
              ? 'verified'
              : 'changed';
        }

        return {
          userId: user.id,
          displayName: user.displayName,
          status,
          lastVerified: currentVerification?.verifiedAt || null,
          fingerprint: currentVerification?.identityKeyFingerprint || null,
        };
      });

      res.json({
        success: true,
        data: verificationResults,
      });
    } catch (error) {
      console.error('Error en verificación de claves:', error);
      res.status(500).json({
        success: false,
        error: 'Error en auditoría de integridad',
      });
    }
  }
);

export default router;
