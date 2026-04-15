// ============================================================
// SecureTeam — Módulo de Cifrado/Descifrado de Alto Nivel
// Interfaz simplificada para el resto de la aplicación.
// Integra X3DH + Double Ratchet + almacenamiento de claves.
// ============================================================

import {
  generateFullKeyBundle,
  exportPublicKey,
  saveToKeyStore,
  loadFromKeyStore,
  clearKeyStore,
  generateFingerprint,
  type IdentityKeyBundle,
} from './keys.js';
import { x3dhInitiate, x3dhRespond } from './x3dh.js';
import { DoubleRatchet } from './doubleRatchet.js';

// -------------------------------------------------------
// Tipos
// -------------------------------------------------------

interface StoredKeyBundle {
  identityPublicKey: string;
  identityPrivateKeyJwk: string;
  signedPreKeyPublicKey: string;
  signedPreKeyPrivateKeyJwk: string;
  signedPreKeySignature: string;
}

interface SessionInfo {
  peerId: string;
  ratchetState: string;
  established: boolean;
}

// Sesiones activas de ratchet (en memoria)
const activeSessions = new Map<string, DoubleRatchet>();

// -------------------------------------------------------
// Inicialización de claves
// -------------------------------------------------------

/**
 * Genera las claves del usuario y las guarda localmente.
 * Retorna las claves públicas para enviar al servidor.
 */
export async function initializeUserKeys(): Promise<{
  publicIdentityKey: string;
  signedPrekey: string;
  signedPrekeySignature: string;
  oneTimePrekeys: string[];
}> {
  // Verificar si ya existen claves
  const existingBundle = await loadFromKeyStore<StoredKeyBundle>('keyBundle');
  if (existingBundle) {
    console.log('🔑 Claves existentes encontradas');
    return {
      publicIdentityKey: existingBundle.identityPublicKey,
      signedPrekey: existingBundle.signedPreKeyPublicKey,
      signedPrekeySignature: existingBundle.signedPreKeySignature,
      oneTimePrekeys: [], // No regenerar one-time keys
    };
  }

  console.log('🔐 Generando nuevas claves de cifrado...');
  const bundle = await generateFullKeyBundle(10);

  // Exportar claves públicas (para el servidor)
  const identityPublicKey = await exportPublicKey(bundle.identityKeyPair.publicKey);
  const signedPreKeyPublicKey = await exportPublicKey(bundle.signedPreKeyPair.publicKey);

  // Exportar claves privadas (para almacenamiento local SOLAMENTE)
  const identityPrivateKeyJwk = JSON.stringify(
    await crypto.subtle.exportKey('jwk', bundle.identityKeyPair.privateKey)
  );
  const signedPreKeyPrivateKeyJwk = JSON.stringify(
    await crypto.subtle.exportKey('jwk', bundle.signedPreKeyPair.privateKey)
  );

  // Exportar one-time prekeys públicas
  const oneTimePrekeys: string[] = [];
  const oneTimePrekeysPrivate: string[] = [];

  for (const otpk of bundle.oneTimePreKeys) {
    oneTimePrekeys.push(await exportPublicKey(otpk.publicKey));
    oneTimePrekeysPrivate.push(
      JSON.stringify(await crypto.subtle.exportKey('jwk', otpk.privateKey))
    );
  }

  // Guardar en almacenamiento local seguro
  const storedBundle: StoredKeyBundle = {
    identityPublicKey: identityPublicKey,
    identityPrivateKeyJwk,
    signedPreKeyPublicKey: signedPreKeyPublicKey,
    signedPreKeyPrivateKeyJwk,
    signedPreKeySignature: bundle.signedPreKeySignature,
  };

  await saveToKeyStore('keyBundle', storedBundle);
  await saveToKeyStore('oneTimePrekeysPrivate', oneTimePrekeysPrivate);

  console.log('✅ Claves generadas y almacenadas de forma segura');

  return {
    publicIdentityKey: identityPublicKey,
    signedPrekey: signedPreKeyPublicKey,
    signedPrekeySignature: bundle.signedPreKeySignature,
    oneTimePrekeys,
  };
}

// -------------------------------------------------------
// Establecer sesión cifrada con otro usuario
// -------------------------------------------------------

/**
 * Inicia una sesión cifrada con otro usuario (como emisor del primer mensaje).
 */
export async function establishSession(
  peerId: string,
  peerKeyBundle: {
    identityKey: string;
    signedPrekey: string;
    signedPrekeySignature: string;
    oneTimePrekey: string | null;
  }
): Promise<{ ephemeralPublicKey: string }> {
  // Cargar nuestras claves
  const storedBundle = await loadFromKeyStore<StoredKeyBundle>('keyBundle');
  if (!storedBundle) {
    throw new Error('No hay claves locales. Ejecuta initializeUserKeys() primero.');
  }

  // Reconstruir nuestro key pair de identidad
  const identityPrivateKey = await crypto.subtle.importKey(
    'jwk',
    JSON.parse(storedBundle.identityPrivateKeyJwk),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
  const identityPublicKeyRaw = await crypto.subtle.exportKey(
    'raw',
    identityPrivateKey
  ).catch(async () => {
    // Si no se puede exportar raw de ECDSA, importar de nuevo como raw
    const { base64ToArrayBuffer } = await import('./keys.js');
    return base64ToArrayBuffer(storedBundle.identityPublicKey);
  });

  // Ejecutar X3DH
  const identityKeyPair = {
    publicKey: await crypto.subtle.importKey(
      'raw',
      typeof identityPublicKeyRaw === 'string'
        ? new TextEncoder().encode(identityPublicKeyRaw)
        : new Uint8Array(identityPublicKeyRaw as ArrayBuffer),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    ).catch(async () => {
      // Fallback: importar desde la clave base64 almacenada
      const { importPublicKeyECDSA } = await import('./keys.js');
      return importPublicKeyECDSA(storedBundle.identityPublicKey);
    }),
    privateKey: identityPrivateKey,
  };

  const x3dhResult = await x3dhInitiate(identityKeyPair, peerKeyBundle);

  // Inicializar Double Ratchet como emisor
  const ratchet = await DoubleRatchet.initAsSender(
    x3dhResult.sharedSecret,
    peerKeyBundle.signedPrekey
  );

  // Guardar sesión
  activeSessions.set(peerId, ratchet);
  const ratchetState = await ratchet.exportState();
  await saveToKeyStore(`session:${peerId}`, {
    peerId,
    ratchetState,
    established: true,
  });

  console.log(`🤝 Sesión cifrada establecida con ${peerId}`);

  return { ephemeralPublicKey: x3dhResult.ephemeralPublicKey };
}

// -------------------------------------------------------
// Cifrar / Descifrar mensajes
// -------------------------------------------------------

/**
 * Cifra un mensaje de texto para un usuario específico.
 * @returns Objeto con ciphertext, iv, y clave DH efímera
 */
export async function encryptMessage(
  peerId: string,
  plaintext: string
): Promise<{
  encryptedContent: string;
  iv: string;
  senderEphemeralPublicKey: string;
}> {
  // Obtener o restaurar sesión de ratchet
  let ratchet = activeSessions.get(peerId);

  if (!ratchet) {
    const sessionInfo = await loadFromKeyStore<SessionInfo>(`session:${peerId}`);
    if (sessionInfo?.ratchetState) {
      ratchet = await DoubleRatchet.importState(sessionInfo.ratchetState);
      activeSessions.set(peerId, ratchet);
    }
  }

  if (!ratchet) {
    throw new Error(
      `No hay sesión cifrada con ${peerId}. ` +
      'Llama a establishSession() primero.'
    );
  }

  // Cifrar
  const encrypted = await ratchet.encrypt(plaintext);

  // Guardar estado actualizado
  const ratchetState = await ratchet.exportState();
  await saveToKeyStore(`session:${peerId}`, {
    peerId,
    ratchetState,
    established: true,
  });

  return {
    encryptedContent: encrypted.ciphertext,
    iv: encrypted.iv,
    senderEphemeralPublicKey: encrypted.dhPublicKey,
  };
}

/**
 * Descifra un mensaje cifrado recibido de otro usuario.
 * @returns El texto en claro del mensaje
 */
export async function decryptMessage(
  senderId: string,
  encryptedContent: string,
  iv: string,
  senderEphemeralPublicKey: string,
  messageNumber: number = 0,
  previousChainLength: number = 0
): Promise<string> {
  // Obtener o restaurar sesión de ratchet
  let ratchet = activeSessions.get(senderId);

  if (!ratchet) {
    const sessionInfo = await loadFromKeyStore<SessionInfo>(`session:${senderId}`);
    if (sessionInfo?.ratchetState) {
      ratchet = await DoubleRatchet.importState(sessionInfo.ratchetState);
      activeSessions.set(senderId, ratchet);
    }
  }

  if (!ratchet) {
    throw new Error(
      `No hay sesión cifrada con ${senderId}. ` +
      'Es necesario establecer la sesión primero.'
    );
  }

  // Descifrar
  const plaintext = await ratchet.decrypt({
    ciphertext: encryptedContent,
    iv,
    dhPublicKey: senderEphemeralPublicKey,
    messageNumber,
    previousChainLength,
  });

  // Guardar estado actualizado
  const ratchetState = await ratchet.exportState();
  await saveToKeyStore(`session:${senderId}`, {
    peerId: senderId,
    ratchetState,
    established: true,
  });

  return plaintext;
}

// -------------------------------------------------------
// Verificación de integridad de claves
// -------------------------------------------------------

/**
 * Obtiene el fingerprint de nuestra clave de identidad.
 */
export async function getMyFingerprint(): Promise<string> {
  const bundle = await loadFromKeyStore<StoredKeyBundle>('keyBundle');
  if (!bundle) {
    throw new Error('No hay claves locales');
  }
  return generateFingerprint(bundle.identityPublicKey);
}

/**
 * Verifica que la clave pública de un usuario no ha cambiado.
 */
export async function verifyPeerKey(
  peerId: string,
  currentPublicKeyBase64: string
): Promise<{
  isVerified: boolean;
  fingerprint: string;
  storedFingerprint: string | null;
}> {
  const fingerprint = await generateFingerprint(currentPublicKeyBase64);

  const storedFingerprint = await loadFromKeyStore<string>(
    `verified:${peerId}`
  );

  if (!storedFingerprint) {
    // Primera vez — guardar fingerprint
    await saveToKeyStore(`verified:${peerId}`, fingerprint);
    return { isVerified: true, fingerprint, storedFingerprint: null };
  }

  const isVerified = fingerprint === storedFingerprint;

  if (!isVerified) {
    console.warn(
      `⚠️ ALERTA: La clave de ${peerId} ha cambiado.\n` +
      `   Anterior: ${storedFingerprint}\n` +
      `   Actual:   ${fingerprint}`
    );
  }

  return { isVerified, fingerprint, storedFingerprint };
}

// -------------------------------------------------------
// Limpieza
// -------------------------------------------------------

/**
 * Destruye todas las claves y sesiones.
 * Se llama al cerrar sesión.
 */
export async function destroyAllKeys(): Promise<void> {
  activeSessions.clear();
  await clearKeyStore();
  console.log('🗑️ Todas las claves eliminadas del dispositivo');
}

/**
 * Verifica si hay claves inicializadas.
 */
export async function hasKeys(): Promise<boolean> {
  const bundle = await loadFromKeyStore<StoredKeyBundle>('keyBundle');
  return bundle !== null;
}
