// ============================================================
// SecureTeam — Seed de la Base de Datos
// Crea 15 usuarios iniciales con identidad Firebase (2 admins)
// ============================================================

import { PrismaClient } from '@prisma/client';
import { generateSecureIdentity } from '../src/utils/identity.js';
import { ref, set } from 'firebase/database';
import { rtdb } from '../src/config/firebase.js';

const prisma = new PrismaClient();

const usersData = [
  // 2 Admins
  { email: 'admin1@secureteam.local', displayName: 'Admin Principal', role: 'ADMIN' },
  { email: 'admin2@secureteam.local', displayName: 'Admin Secundario', role: 'ADMIN' },
  // 13 Users
  { email: 'Mary@secureteam.local', displayName: 'Mary Luz', role: 'USER' },
  { email: 'maria@secureteam.local', displayName: 'María López', role: 'USER' },
  { email: 'juan@secureteam.local', displayName: 'Juan Martínez', role: 'USER' },
  { email: 'ana@secureteam.local', displayName: 'Ana Rodríguez', role: 'USER' },
  { email: 'luis@secureteam.local', displayName: 'Luis Fernández', role: 'USER' },
  { email: 'laura@secureteam.local', displayName: 'Laura Sánchez', role: 'USER' },
  { email: 'pedro@secureteam.local', displayName: 'Pedro Gómez', role: 'USER' },
  { email: 'sofia@secureteam.local', displayName: 'Sofía Díaz', role: 'USER' },
  { email: 'diego@secureteam.local', displayName: 'Diego Torres', role: 'USER' },
  { email: 'carmen@secureteam.local', displayName: 'Carmen Ruiz', role: 'USER' },
  { email: 'jorge@secureteam.local', displayName: 'Jorge Romero', role: 'USER' },
  { email: 'lucia@secureteam.local', displayName: 'Lucía Navarro', role: 'USER' },
  { email: 'miguel@secureteam.local', displayName: 'Miguel Castro', role: 'USER' },
];

async function seed() {
  console.log('🌱 Comenzando proceso de seed...');

  console.log('🧹 Limpiando base de datos anterior para generar IDs limpios...');
  await prisma.message.deleteMany({});
  await prisma.conversationMember.deleteMany({});
  await prisma.conversation.deleteMany({});
  await prisma.preKeyBundle.deleteMany({});
  await prisma.keyVerification.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('👤 Creando 15 Usuarios y sincronizando con Firebase RTDB...\n');

  for (const data of usersData) {
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

    const user = await prisma.user.create({
      data: {
        email: data.email,
        displayName: data.displayName,
        role: data.role as 'ADMIN' | 'USER',
        ssoSubjectId: `sso_${data.email.replace(/[^a-zA-Z0-9]/g, '_')}`,
        masterId: identity.masterId,
        publicCode: identity.publicCode,
        confirmPin: identity.confirmPin
      },
    });

    try {
      await set(ref(rtdb, `identities/publicCode_${identity.publicCode}`), {
        masterId: identity.masterId,
        userId: user.id,
        confirmPin: identity.confirmPin
      });
    } catch(err) {
      console.error(`Error de Firebase para ${data.displayName}: `, err);
    }
    
    console.log(`✅ [${data.role}] ${user.displayName} -> publicCode: ${identity.publicCode} (PIN: ${identity.confirmPin})`);
  }

  const allUsers = await prisma.user.findMany();

  if (allUsers.length >= 3) {
    const groupConv = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: 'Equipo Alfa',
        createdBy: allUsers[0].id,
        maxMembers: 5,
        members: {
          create: allUsers.slice(0, 4).map((user: any, i: number) => ({
            userId: user.id,
            memberRole: i === 0 ? 'ADMIN' : 'MEMBER',
            canWrite: true,
          })),
        },
      },
    });
    console.log(`\n✅ Grupo creado de ejemplo: ${groupConv.name}`);
  }

  console.log('\n🌟 Base de datos poblada de maravilla. ¡Todo listo!\n');
  process.exit(0);
}

seed()
  .catch((error) => {
    console.error('Error en seed:', error);
    process.exit(1);
  });
