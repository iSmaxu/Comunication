// ============================================================
// SecureTeam — Rutas de Usuarios
// Listar usuarios disponibles para crear conversaciones
// ============================================================

import { Router, Response } from 'express';
import { prisma } from '../config/database.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// -------------------------------------------------------
// GET /api/users — Listar usuarios del equipo
// -------------------------------------------------------
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const users = await prisma.user.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        role: true,
        publicIdentityKey: true,
        isActive: true,
        lastSeenAt: true,
      },
      orderBy: { displayName: 'asc' },
    });

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.error('Error listando usuarios:', error);
    res.status(500).json({
      success: false,
      error: 'Error al listar usuarios',
    });
  }
});

// -------------------------------------------------------
// GET /api/users/:id/keybundle — Obtener key bundle para E2E
// -------------------------------------------------------
router.get(
  '/:id/keybundle',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.params.id as string, isActive: true },
        select: {
          id: true,
          publicIdentityKey: true,
          signedPrekey: true,
          signedPrekeySignature: true,
        },
      });

      if (!user || !user.publicIdentityKey) {
        res.status(404).json({
          success: false,
          error: 'Usuario no encontrado o sin claves registradas',
        });
        return;
      }

      // Obtener un one-time prekey disponible
      const otpk = await prisma.preKeyBundle.findFirst({
        where: { userId: req.params.id as string, isUsed: false },
        orderBy: { createdAt: 'asc' },
      });

      if (otpk) {
        await prisma.preKeyBundle.update({
          where: { id: otpk.id },
          data: { isUsed: true },
        });
      }

      res.json({
        success: true,
        data: {
          identityKey: user.publicIdentityKey,
          signedPrekey: user.signedPrekey,
          signedPrekeySignature: user.signedPrekeySignature,
          oneTimePrekey: otpk?.oneTimePrekeyPublic || null,
        },
      });
    } catch (error) {
      console.error('Error obteniendo key bundle:', error);
      res.status(500).json({
        success: false,
        error: 'Error al obtener claves',
      });
    }
  }
);

export default router;
