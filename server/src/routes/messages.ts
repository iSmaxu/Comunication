// ============================================================
// SecureTeam — Rutas de Mensajes
// Todo contenido que pasa por aquí está CIFRADO (ciphertext)
// El servidor solo retransmite, nunca lee el contenido
// ============================================================

import { Router, Response } from 'express';
import { prisma } from '../config/database.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

router.use(authMiddleware);

// -------------------------------------------------------
// GET /api/messages/:conversationId — Listar mensajes
// -------------------------------------------------------
router.get(
  '/:conversationId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { conversationId } = req.params;
      const { cursor, limit = '50' } = req.query;

      // Verificar que el usuario es miembro de la conversación
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversationId: conversationId as string,
          userId: req.user!.id,
        },
      });

      if (!membership) {
        res.status(403).json({
          success: false,
          error: 'No eres miembro de esta conversación',
        });
        return;
      }

      const take = Math.min(parseInt(limit as string, 10), 100);

      const messages = await prisma.message.findMany({
        where: {
          conversationId: conversationId as string,
          ...(cursor ? { createdAt: { lt: new Date(cursor as string) } } : {}),
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
              sender: {
                select: { displayName: true },
              },
            },
          },
          receipts: req.user!.role === 'ADMIN'
            ? {
                select: {
                  userId: true,
                  deliveredAt: true,
                  readAt: true,
                },
              }
            : false,
        },
        orderBy: { createdAt: 'desc' },
        take,
      });

      // Marcar como entregados
      const messageIds = messages.map((m: any) => m.id);
      if (messageIds.length > 0) {
        await prisma.messageReceipt.createMany({
          data: messageIds
            .filter((id: any) => {
              const msg = messages.find((m: any) => m.id === id);
              return msg && msg.senderId !== req.user!.id;
            })
            .map((messageId: any) => ({
              messageId,
              userId: req.user!.id,
              deliveredAt: new Date(),
            })),
          skipDuplicates: true,
        });
      }

      res.json({
        success: true,
        data: messages.reverse(), // Cronológico
        hasMore: messages.length === take,
      });
    } catch (error) {
      console.error('Error listando mensajes:', error);
      res.status(500).json({
        success: false,
        error: 'Error al listar mensajes',
      });
    }
  }
);

// -------------------------------------------------------
// POST /api/messages — Enviar mensaje cifrado
// NOTA: encryptedContent es ciphertext — el servidor no sabe qué dice
// -------------------------------------------------------
router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const {
      conversationId,
      encryptedContent,
      iv,
      senderEphemeralPublicKey,
      replyToId,
      autoDestructMinutes,
    } = req.body;

    if (!conversationId || !encryptedContent || !iv) {
      res.status(400).json({
        success: false,
        error: 'Se requiere conversationId, encryptedContent e iv',
      });
      return;
    }

    // Verificar membresía y permisos de escritura
    const membership = await prisma.conversationMember.findFirst({
      where: {
        conversationId,
        userId: req.user!.id,
      },
    });

    if (!membership) {
      res.status(403).json({
        success: false,
        error: 'No eres miembro de esta conversación',
      });
      return;
    }

    if (!membership.canWrite) {
      res.status(403).json({
        success: false,
        error: 'No tienes permisos de escritura en este canal',
      });
      return;
    }

    // Calcular auto-destrucción si aplica
    let autoDestructAt: Date | null = null;
    if (autoDestructMinutes) {
      // Verificar que hay acuerdo activo
      const agreement = await prisma.autoDestructAgreement.findFirst({
        where: {
          conversationId,
          isActive: true,
        },
      });

      if (agreement) {
        autoDestructAt = new Date(Date.now() + agreement.minutes * 60 * 1000);
      }
    }

    // Verificar replyTo si se proporciona
    if (replyToId) {
      const replyMessage = await prisma.message.findFirst({
        where: {
          id: replyToId,
          conversationId,
        },
      });

      if (!replyMessage) {
        res.status(400).json({
          success: false,
          error: 'Mensaje de respuesta no encontrado en esta conversación',
        });
        return;
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: req.user!.id,
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
            sender: {
              select: { displayName: true },
            },
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({
      success: false,
      error: 'Error al enviar mensaje',
    });
  }
});

// -------------------------------------------------------
// DELETE /api/messages/:messageId — Borrar mensaje para todos
// -------------------------------------------------------
router.delete(
  '/:messageId',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { messageId } = req.params;

      const message = await prisma.message.findUnique({
        where: { id: messageId as string },
      });

      if (!message) {
        res.status(404).json({
          success: false,
          error: 'Mensaje no encontrado',
        });
        return;
      }

      // Solo el emisor o un admin puede borrar
      if (message.senderId !== req.user!.id && req.user!.role !== 'ADMIN') {
        res.status(403).json({
          success: false,
          error: 'Solo puedes borrar tus propios mensajes',
        });
        return;
      }

      await prisma.message.update({
        where: { id: messageId as string },
        data: {
          isDeleted: true,
          deletedForAll: true,
          encryptedContent: '[ELIMINADO]',
          iv: '',
        },
      });

      res.json({
        success: true,
        message: 'Mensaje eliminado para todos',
      });
    } catch (error) {
      console.error('Error borrando mensaje:', error);
      res.status(500).json({
        success: false,
        error: 'Error al borrar mensaje',
      });
    }
  }
);

// -------------------------------------------------------
// POST /api/messages/:messageId/read — Marcar como leído
// (Solo se usa para indicadores admin)
// -------------------------------------------------------
router.post(
  '/:messageId/read',
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      const { messageId } = req.params;

      await prisma.messageReceipt.upsert({
        where: {
          messageId_userId: {
            messageId: messageId as string,
            userId: req.user!.id,
          },
        },
        create: {
          messageId: messageId as string,
          userId: req.user!.id,
          deliveredAt: new Date(),
          readAt: new Date(),
        },
        update: {
          readAt: new Date(),
        },
      });

      res.json({
        success: true,
        message: 'Mensaje marcado como leído',
      });
    } catch (error) {
      console.error('Error marcando como leído:', error);
      res.status(500).json({
        success: false,
        error: 'Error al marcar como leído',
      });
    }
  }
);

export default router;
