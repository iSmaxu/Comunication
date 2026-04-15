import { Router, Response } from 'express';
import { prisma } from '../config/database.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { ref, get, set } from 'firebase/database';
import { rtdb } from '../config/firebase.js';
import { joinUserToConversation, getIo } from '../services/websocket.js';

const router = Router();
router.use(authMiddleware);

// POST /api/handshakes/request
// Usuario A solicita conectar con Usuario B usando su publicCode
router.post('/request', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
   try {
     const { targetPublicCode } = req.body;
     
     if (!targetPublicCode) {
       res.status(400).json({ success: false, error: "Se requiere targetPublicCode" });
       return;
     }

     const sender = await prisma.user.findUnique({ 
       where: { id: req.user!.id },
       select: { publicCode: true }
     });

     if (!sender || !sender.publicCode) {
       res.status(400).json({ success: false, error: "Usuario emisor inválido" });
       return;
     }

     // Verificar si el objetivo existe en RTDB
     const targetSnap = await get(ref(rtdb, `identities/publicCode_${targetPublicCode}`));
     if (!targetSnap.exists()) {
       res.status(404).json({ success: false, error: "Código público no encontrado" });
       return;
     }

     const requestId = `req_${sender.publicCode}_${targetPublicCode}`;
     
     // Guardar la intención en Firebase
     await set(ref(rtdb, `handshakes/${requestId}`), {
        fromPublicCode: sender.publicCode,
        toPublicCode: targetPublicCode,
        status: "pending_confirmation",
        createdAt: Date.now()
     });

     res.json({ success: true, message: "Solicitud enviada", requestId });
   } catch (error) {
     console.error('Error enviando handshake request:', error);
     res.status(500).json({ success: false, error: "Error en el servidor" });
   }
});

// POST /api/handshakes/accept
// Usuario B acepta conexión de Usuario A escribiendo el confirmPin de A
router.post('/accept', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
   try {
     const { requestId, senderConfirmPin } = req.body;
     
     if (!requestId || !senderConfirmPin) {
       res.status(400).json({ success: false, error: "Faltan datos de confirmación" });
       return;
     }

     // 1. Obtener el handshake de Firebase
     const snapshot = await get(ref(rtdb, `handshakes/${requestId}`));
     if (!snapshot.exists()) {
       res.status(404).json({ success: false, error: "Solicitud no encontrada" });
       return;
     }

     const handshake = snapshot.val();

     // Validar que no se haya aceptado ya
     if (handshake.status === "accepted") {
        res.status(400).json({ success: false, error: "Esta solicitud ya fue aceptada" });
        return;
     }
     
     // 2. Obtener identidad del emisor (A) en Firebase
     const senderIdentitySnap = await get(ref(rtdb, `identities/publicCode_${handshake.fromPublicCode}`));
     if (!senderIdentitySnap.exists()) {
       res.status(404).json({ success: false, error: "Identidad del emisor no encontrada" });
       return;
     }

     const senderIdentity = senderIdentitySnap.val();

     // 3. Validar el PIN
     if (senderIdentity.confirmPin !== senderConfirmPin) {
        res.status(403).json({ success: false, error: "PIN de confirmación incorrecto" });
        return;
     }

     // 4. Crear la conversación DIRECT en PostgreSQL
     const senderUserId = senderIdentity.userId;
     const receiverUserId = req.user!.id;

     // Revisar si ya existe
     const existingDirect = await prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { members: { some: { userId: receiverUserId } } },
            { members: { some: { userId: senderUserId } } }
          ]
        }
     });

     if (existingDirect) {
        await set(ref(rtdb, `handshakes/${requestId}/status`), "accepted");
        res.json({ success: true, conversationId: existingDirect.id, message: "La conversación ya existía" });
        return;
     }

     const conversation = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          createdBy: receiverUserId,
          maxMembers: 2,
          members: {
            create: [
              { userId: receiverUserId, memberRole: 'ADMIN', canWrite: true },
              { userId: senderUserId, memberRole: 'MEMBER', canWrite: true },
            ],
          },
        }
     });

     // 5. Marcar handshake como Accepted
     await set(ref(rtdb, `handshakes/${requestId}/status`), "accepted");

     // 6. Join connected sockets and emit new conversation
     joinUserToConversation(receiverUserId, conversation.id);
     joinUserToConversation(senderUserId, conversation.id);
     
     const io = getIo();
     if (io) {
        io.to(`conversation:${conversation.id}`).emit('conversation:new', { conversationId: conversation.id });
     }

     res.json({ success: true, conversationId: conversation.id });
   } catch (error) {
     console.error('Error aceptando handshake:', error);
     res.status(500).json({ success: false, error: "Error en el servidor" });
   }
});

// GET /api/handshakes/pending
// Obtener las solicitudes pendientes para el usuario actual
router.get('/pending', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
   try {
     const me = await prisma.user.findUnique({ 
        where: { id: req.user!.id },
        select: { publicCode: true }
     });

     if (!me || !me.publicCode) {
        res.status(400).json({ success: false, error: "Usuario sin publicCode" });
        return;
     }

     const snap = await get(ref(rtdb, `handshakes`));
     if (!snap.exists()) {
        res.json({ success: true, data: [] });
        return;
     }

     const allHandshakes = snap.val();
     const pending = Object.entries(allHandshakes)
        .map(([id, val]: [string, any]) => ({ id, ...val }))
        .filter(h => h.toPublicCode === me.publicCode && h.status === 'pending_confirmation');

     res.json({ success: true, data: pending });
   } catch (error) {
     console.error('Error obteniendo handshakes pendientes:', error);
     res.status(500).json({ success: false, error: "Error en el servidor" });
   }
});

export default router;
