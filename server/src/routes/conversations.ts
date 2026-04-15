// ============================================================
// SecureTeam — Rutas de Conversaciones
// Crear conversaciones directas, grupos y canales de anuncios
// ============================================================

import { Router, Response } from 'express';
import { prisma } from '../config/database.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { adminOnly } from '../middleware/roles.js';

const router = Router();

// Todas las rutas requieren autenticación
router.use(authMiddleware);

// -------------------------------------------------------
// GET /api/conversations — Listar conversaciones del usuario
// -------------------------------------------------------
router.get('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: { userId: req.user!.id },
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                role: true,
                publicIdentityKey: true,
                isActive: true,
                lastSeenAt: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            senderId: true,
            isDeleted: true,
            createdAt: true,
            sender: {
              select: { displayName: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Formatear respuesta
    const formatted = conversations.map((conv: any) => ({
      ...conv,
      lastMessage: conv.messages[0]
        ? {
            id: conv.messages[0].id,
            senderId: conv.messages[0].senderId,
            isDeleted: conv.messages[0].isDeleted,
            createdAt: conv.messages[0].createdAt,
            senderName: conv.messages[0].sender.displayName,
          }
        : null,
      messages: undefined,
    }));

    res.json({
      success: true,
      data: formatted,
    });
  } catch (error) {
    console.error('Error listando conversaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error al listar conversaciones',
    });
  }
});

// -------------------------------------------------------
// POST /api/conversations — Crear nueva conversación
// -------------------------------------------------------
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { type, name, memberIds } = req.body;

    // Validaciones
    if (!type || !memberIds || !Array.isArray(memberIds)) {
      res.status(400).json({
        success: false,
        error: 'Se requiere type y memberIds',
      });
      return;
    }

    // Validar tipo de conversación
    if (!['DIRECT', 'GROUP', 'ANNOUNCEMENT'].includes(type)) {
      res.status(400).json({
        success: false,
        error: 'Tipo de conversación inválido. Usar: DIRECT, GROUP o ANNOUNCEMENT',
      });
      return;
    }

    // Solo admins pueden crear canales de anuncios
    if (type === 'ANNOUNCEMENT' && req.user!.role !== 'ADMIN') {
      res.status(403).json({
        success: false,
        error: 'Solo los administradores pueden crear canales de anuncios',
      });
      return;
    }

    // Validar límites de miembros
    const allMembers = [...new Set([req.user!.id, ...memberIds])];

    if (type === 'DIRECT' && allMembers.length !== 2) {
      res.status(400).json({
        success: false,
        error: 'Las conversaciones directas deben tener exactamente 2 miembros',
      });
      return;
    }

    if (type === 'GROUP' && allMembers.length > 5) {
      res.status(400).json({
        success: false,
        error: 'Los grupos pueden tener máximo 5 miembros',
      });
      return;
    }

    // Para DIRECT: verificar que no exista ya una conversación directa entre estos usuarios
    if (type === 'DIRECT') {
      const existingDirect = await prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: allMembers.map((memberId) => ({
            members: { some: { userId: memberId } },
          })),
        },
      });

      if (existingDirect) {
        res.json({
          success: true,
          data: existingDirect,
          message: 'Conversación directa ya existente',
        });
        return;
      }
    }

    // Verificar que todos los miembros existen
    const validMembers = await prisma.user.findMany({
      where: { id: { in: allMembers }, isActive: true },
    });

    if (validMembers.length !== allMembers.length) {
      res.status(400).json({
        success: false,
        error: 'Algunos usuarios no existen o están desactivados',
      });
      return;
    }

    // Crear conversación con miembros
    const conversation = await prisma.conversation.create({
      data: {
        type,
        name: type !== 'DIRECT' ? name || 'Grupo sin nombre' : null,
        createdBy: req.user!.id,
        maxMembers: type === 'DIRECT' ? 2 : type === 'GROUP' ? 5 : 15,
        members: {
          create: allMembers.map((memberId) => ({
            userId: memberId,
            memberRole: memberId === req.user!.id ? 'ADMIN' : 'MEMBER',
            // En anuncios, solo el creador puede escribir
            canWrite: type === 'ANNOUNCEMENT' ? memberId === req.user!.id : true,
          })),
        },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                role: true,
                publicIdentityKey: true,
                isActive: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error('Error creando conversación:', error);
    res.status(500).json({
      success: false,
      error: 'Error al crear conversación',
    });
  }
});

// -------------------------------------------------------
// GET /api/conversations/:id — Detalle de conversación
// -------------------------------------------------------
router.get('/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: req.params.id as string,
        members: { some: { userId: req.user!.id } },
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                role: true,
                publicIdentityKey: true,
                isActive: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      res.status(404).json({
        success: false,
        error: 'Conversación no encontrada',
      });
      return;
    }

    res.json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    console.error('Error obteniendo conversación:', error);
    res.status(500).json({
      success: false,
      error: 'Error al obtener conversación',
    });
  }
});

// -------------------------------------------------------
// GET /api/conversations/:id/keybundle/:userId
// Obtener el key bundle de un usuario para iniciar cifrado
// -------------------------------------------------------
router.get(
  '/:id/keybundle/:userId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Verificar que ambos usuarios están en la conversación
      const isMember = await prisma.conversationMember.findFirst({
        where: {
          conversationId: req.params.id as string,
          userId: req.user!.id,
        },
      });

      if (!isMember) {
        res.status(403).json({
          success: false,
          error: 'No eres miembro de esta conversación',
        });
        return;
      }

      // Obtener datos del usuario objetivo
      const targetUser = await prisma.user.findUnique({
        where: { id: req.params.userId as string },
        select: {
          id: true,
          publicIdentityKey: true,
          signedPrekey: true,
          signedPrekeySignature: true,
        },
      });

      if (!targetUser || !targetUser.publicIdentityKey) {
        res.status(404).json({
          success: false,
          error: 'Usuario no encontrado o sin claves registradas',
        });
        return;
      }

      // Obtener un one-time prekey disponible
      const oneTimePrekey = await prisma.preKeyBundle.findFirst({
        where: {
          userId: req.params.userId as string,
          isUsed: false,
        },
        orderBy: { createdAt: 'asc' },
      });

      // Marcar como usado
      if (oneTimePrekey) {
        await prisma.preKeyBundle.update({
          where: { id: oneTimePrekey.id },
          data: { isUsed: true },
        });
      }

      res.json({
        success: true,
        data: {
          identityKey: targetUser.publicIdentityKey,
          signedPrekey: targetUser.signedPrekey,
          signedPrekeySignature: targetUser.signedPrekeySignature,
          oneTimePrekey: oneTimePrekey?.oneTimePrekeyPublic || null,
        },
      });
    } catch (error) {
      console.error('Error obteniendo key bundle:', error);
      res.status(500).json({
        success: false,
        error: 'Error al obtener claves del usuario',
      });
    }
  }
);

export default router;
