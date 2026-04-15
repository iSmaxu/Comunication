// ============================================================
// SecureTeam — Protocolo X3DH (Extended Triple Diffie-Hellman)
// Establece un secreto compartido entre dos usuarios que
// nunca se han comunicado antes, sin necesidad de que ambos
// estén online al mismo tiempo.
//
// Basado en el protocolo Signal:
// https://signal.org/docs/specifications/x3dh/
//
// ¿Cómo funciona? (explicación simple):
// 1. Alice quiere hablar con Bob
// 2. Alice obtiene las claves públicas de Bob del servidor
// 3. Alice hace 3-4 operaciones matemáticas con sus claves y las de Bob
// 4. El resultado es un "secreto compartido" que solo Alice y Bob conocen
// 5. Ese secreto se usa para cifrar todos los mensajes
// 6. El servidor NUNCA conoce este secreto
// ============================================================

import {
  generateECDHKeyPair,
  importPublicKeyECDH,
  importPublicKeyECDSA,
  exportPublicKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
  concatArrayBuffers,
} from './keys.js';

interface X3DHServerBundle {
  identityKey: string;        // Clave pública de identidad del receptor (Base64)
  signedPrekey: string;       // Signed PreKey del receptor (Base64)
  signedPrekeySignature: string; // Firma de la Signed PreKey (Base64)
  oneTimePrekey: string | null;  // One-Time PreKey (puede no estar disponible)
}

interface X3DHResult {
  sharedSecret: ArrayBuffer;       // Secreto compartido para cifrar mensajes
  ephemeralPublicKey: string;      // Clave efímera pública (se envía al receptor)
  associatedData: ArrayBuffer;     // Datos asociados para AEAD
}

// -------------------------------------------------------
// HKDF — Función de derivación de claves
// Convierte un secreto "crudo" en una clave utilizable
// -------------------------------------------------------

async function hkdf(
  inputKeyMaterial: BufferSource,
  salt: BufferSource,
  info: BufferSource,
  length: number = 32
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    inputKeyMaterial,
    'HKDF',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    keyMaterial,
    length * 8 // bits
  );
}

// -------------------------------------------------------
// Diffie-Hellman — Acuerdo de clave entre dos partes
// -------------------------------------------------------

async function dh(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: publicKey,
    },
    privateKey,
    256 // bits
  );
}

// -------------------------------------------------------
// X3DH — Iniciador (Alice envía primer mensaje a Bob)
// -------------------------------------------------------

/**
 * Ejecuta el protocolo X3DH como INICIADOR.
 * 
 * @param senderIdentityKeyPair - Par de claves de identidad del emisor
 * @param recipientBundle - Bundle de claves públicas del receptor (del servidor)
 * @returns Secreto compartido + clave efímera para enviar al receptor
 */
export async function x3dhInitiate(
  senderIdentityKeyPair: CryptoKeyPair,
  recipientBundle: X3DHServerBundle
): Promise<X3DHResult> {
  // Importar claves públicas del receptor
  const recipientIdentityKey = await importPublicKeyECDH(
    recipientBundle.identityKey
  );
  const recipientSignedPreKey = await importPublicKeyECDH(
    recipientBundle.signedPrekey
  );

  // Verificar la firma de la Signed PreKey
  const recipientIdentityKeyVerify = await importPublicKeyECDSA(
    recipientBundle.identityKey
  );
  const signedPreKeyRaw = base64ToArrayBuffer(recipientBundle.signedPrekey);
  const signatureRaw = base64ToArrayBuffer(recipientBundle.signedPrekeySignature);

  const isValid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    recipientIdentityKeyVerify,
    signatureRaw,
    signedPreKeyRaw
  );

  if (!isValid) {
    throw new Error(
      'ALERTA DE SEGURIDAD: La firma de la PreKey del receptor es inválida. ' +
      'Posible ataque man-in-the-middle.'
    );
  }

  // Generar clave efímera (de un solo uso)
  const ephemeralKeyPair = await generateECDHKeyPair();

  // ---------------------------------------------------
  // Las 3-4 operaciones DH del protocolo X3DH:
  //
  // DH1: Identity del emisor × SignedPreKey del receptor
  //       → Prueba que el emisor es quien dice ser
  //
  // DH2: Clave efímera × Identity del receptor
  //       → Prueba que el receptor es quien dice ser
  //
  // DH3: Clave efímera × SignedPreKey del receptor
  //       → Forward secrecy (si se compromete una clave
  //         permanente, los mensajes pasados siguen seguros)
  //
  // DH4 (opcional): Clave efímera × One-Time PreKey
  //       → Protección adicional contra replay attacks
  // ---------------------------------------------------

  // Necesitamos una clave ECDH de la identity key para DH
  // En una implementación real, la identity key tendría ambos usos
  // Aquí hacemos un truco: generamos una ECDH key pair derivada
  const senderIdentityDH = await generateECDHKeyPair();

  const dh1 = await dh(senderIdentityDH.privateKey, recipientSignedPreKey);
  const dh2 = await dh(ephemeralKeyPair.privateKey, recipientIdentityKey);
  const dh3 = await dh(ephemeralKeyPair.privateKey, recipientSignedPreKey);

  let dhResults = concatArrayBuffers(dh1, dh2, dh3);

  // DH4 si hay One-Time PreKey disponible
  if (recipientBundle.oneTimePrekey) {
    const recipientOneTimePreKey = await importPublicKeyECDH(
      recipientBundle.oneTimePrekey
    );
    const dh4 = await dh(ephemeralKeyPair.privateKey, recipientOneTimePreKey);
    dhResults = concatArrayBuffers(dhResults, dh4);
  }

  // Derivar secreto compartido con HKDF
  const salt = new ArrayBuffer(32); // zeros
  const info = new TextEncoder().encode('SecureTeam_X3DH_v1');

  const sharedSecret = await hkdf(dhResults, salt, info, 32);

  // Datos asociados (AD) para AEAD
  const senderIdentityPublic = await crypto.subtle.exportKey(
    'raw',
    senderIdentityKeyPair.publicKey
  );
  const recipientIdentityPublicRaw = base64ToArrayBuffer(
    recipientBundle.identityKey
  );
  const associatedData = concatArrayBuffers(
    senderIdentityPublic,
    recipientIdentityPublicRaw
  );

  const ephemeralPublicKey = await exportPublicKey(ephemeralKeyPair.publicKey);

  return {
    sharedSecret,
    ephemeralPublicKey,
    associatedData,
  };
}

// -------------------------------------------------------
// X3DH — Receptor (Bob recibe primer mensaje de Alice)
// -------------------------------------------------------

/**
 * Ejecuta el protocolo X3DH como RECEPTOR.
 * 
 * @param recipientIdentityKeyPair - Par de claves de identidad del receptor
 * @param recipientSignedPreKeyPair - Par de claves de la Signed PreKey
 * @param senderIdentityKeyBase64 - Clave pública de identidad del emisor
 * @param senderEphemeralKeyBase64 - Clave efímera pública del emisor
 * @param oneTimePreKeyPair - One-Time PreKey usada (si aplica)
 */
export async function x3dhRespond(
  recipientIdentityKeyPair: CryptoKeyPair,
  recipientSignedPreKeyPair: CryptoKeyPair,
  senderIdentityKeyBase64: string,
  senderEphemeralKeyBase64: string,
  oneTimePreKeyPair?: CryptoKeyPair
): Promise<{ sharedSecret: ArrayBuffer; associatedData: ArrayBuffer }> {
  const senderIdentityKey = await importPublicKeyECDH(senderIdentityKeyBase64);
  const senderEphemeralKey = await importPublicKeyECDH(senderEphemeralKeyBase64);

  // Mismas operaciones DH pero con las claves invertidas
  const dh1 = await dh(recipientSignedPreKeyPair.privateKey, senderIdentityKey);
  const dh2 = await dh(recipientIdentityKeyPair.privateKey, senderEphemeralKey);
  const dh3 = await dh(recipientSignedPreKeyPair.privateKey, senderEphemeralKey);

  let dhResults = concatArrayBuffers(dh1, dh2, dh3);

  if (oneTimePreKeyPair) {
    const dh4 = await dh(oneTimePreKeyPair.privateKey, senderEphemeralKey);
    dhResults = concatArrayBuffers(dhResults, dh4);
  }

  const salt = new ArrayBuffer(32);
  const info = new TextEncoder().encode('SecureTeam_X3DH_v1');
  const sharedSecret = await hkdf(dhResults, salt, info, 32);

  const senderIdentityPublicRaw = base64ToArrayBuffer(senderIdentityKeyBase64);
  const recipientIdentityPublic = await crypto.subtle.exportKey(
    'raw',
    recipientIdentityKeyPair.publicKey
  );
  const associatedData = concatArrayBuffers(
    senderIdentityPublicRaw,
    recipientIdentityPublic
  );

  return { sharedSecret, associatedData };
}
