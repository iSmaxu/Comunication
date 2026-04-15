import crypto from 'crypto';

export function generateSecureIdentity() {
  const baseChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let baseId = '';
  for (let i = 0; i < 16; i++) {
    baseId += baseChars.charAt(crypto.randomInt(0, baseChars.length));
  }

  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const ss = String(now.getSeconds()).padStart(2, '0');
  const confirmPin = `${yy}${ss}`;
  
  const masterId = baseId + confirmPin;

  // 3 caracteres al azar de los primeros 14 según el plan
  let random3 = '';
  for (let i = 0; i < 3; i++) {
    const rIndex = crypto.randomInt(0, 14);
    random3 += baseId[rIndex];
  }
  
  // Los 2 últimos caracteres de los 16 iniciales (pos 14 y 15 en array 0-index)
  const last2 = baseId.slice(14, 16);
  const publicCode = random3 + last2;

  return {
    masterId,
    publicCode,
    confirmPin
  };
}
