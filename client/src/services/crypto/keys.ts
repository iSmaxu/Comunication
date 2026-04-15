// ============================================================
// SecureTeam — Gestión de Claves Criptográficas
// Genera, almacena y exporta claves para el protocolo E2E
// Usa exclusivamente WebCrypto API (estándar del navegador)
//
// TODAS las claves privadas quedan SOLO en el dispositivo.
// Solo las claves públicas se envían al servidor.
// ============================================================

const ECDH_PARAMS: EcKeyGenParams = {
  name: 'ECDH',
  namedCurve: 'P-256',
};

const ECDSA_PARAMS: EcKeyGenParams = {
  name: 'ECDSA',
  namedCurve: 'P-256',
};

export interface KeyPairExported {
  publicKey: string;   // Base64
  privateKey: string;  // Base64
}

export interface IdentityKeyBundle {
  identityKeyPair: CryptoKeyPair;
  signedPreKeyPair: CryptoKeyPair;
  signedPreKeySignature: string; // Base64
  oneTimePreKeys: CryptoKeyPair[];
}

// -------------------------------------------------------
// Generación de claves
// -------------------------------------------------------

/**
 * Genera un par de claves ECDH (Diffie-Hellman sobre curva elíptica).
 * Se usa para acuerdo de claves entre dos usuarios.
 */
export async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    ECDH_PARAMS,
    true, // extractable (para poder exportar)
    ['deriveBits']
  );
}

/**
 * Genera un par de claves ECDSA (Firma Digital sobre curva elíptica).
 * Se usa para firmar las PreKeys y verificar identidad.
 */
export async function generateSigningKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    ECDSA_PARAMS,
    true,
    ['sign', 'verify']
  );
}

/**
 * Genera el bundle completo de claves para un nuevo usuario:
 * - Identity Key: clave permanente que identifica al usuario
 * - Signed PreKey: clave temporal firmada por la Identity Key
 * - One-Time PreKeys: claves de un solo uso para el protocolo X3DH
 */
export async function generateFullKeyBundle(
  numOneTimePreKeys: number = 10
): Promise<IdentityKeyBundle> {
  // 1. Identity Key (permanente)
  const identityKeyPair = await generateSigningKeyPair();

  // 2. Signed PreKey (se rota periódicamente)
  const signedPreKeyPair = await generateECDHKeyPair();

  // 3. Firmar la Signed PreKey con la Identity Key
  const signedPreKeyPublicRaw = await crypto.subtle.exportKey(
    'raw',
    signedPreKeyPair.publicKey
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identityKeyPair.privateKey,
    signedPreKeyPublicRaw
  );
  const signedPreKeySignature = arrayBufferToBase64(signature);

  // 4. One-Time PreKeys
  const oneTimePreKeys: CryptoKeyPair[] = [];
  for (let i = 0; i < numOneTimePreKeys; i++) {
    const preKey = await generateECDHKeyPair();
    oneTimePreKeys.push(preKey);
  }

  return {
    identityKeyPair,
    signedPreKeyPair,
    signedPreKeySignature,
    oneTimePreKeys,
  };
}

// -------------------------------------------------------
// Exportación / Importación de claves (para enviar al servidor)
// -------------------------------------------------------

/**
 * Exporta una clave pública a formato Base64 (para enviar al servidor).
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64(raw);
}

/**
 * Importa una clave pública ECDH desde Base64 (recibida del servidor).
 */
export async function importPublicKeyECDH(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    ECDH_PARAMS,
    true,
    []
  );
}

/**
 * Importa una clave pública ECDSA desde Base64 (para verificar firmas).
 */
export async function importPublicKeyECDSA(base64: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(base64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    ECDSA_PARAMS,
    true,
    ['verify']
  );
}

/**
 * Exporta una clave privada a formato Base64 (para almacenamiento local).
 * ⚠️ NUNCA enviar al servidor.
 */
export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return btoa(JSON.stringify(jwk));
}

/**
 * Importa una clave privada desde Base64-JWK (del almacenamiento local).
 */
export async function importPrivateKeyECDH(base64Jwk: string): Promise<CryptoKey> {
  const jwk = JSON.parse(atob(base64Jwk));
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    ECDH_PARAMS,
    true,
    ['deriveBits']
  );
}

export async function importPrivateKeyECDSA(base64Jwk: string): Promise<CryptoKey> {
  const jwk = JSON.parse(atob(base64Jwk));
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    ECDSA_PARAMS,
    true,
    ['sign']
  );
}

// -------------------------------------------------------
// Almacenamiento seguro local (IndexedDB)
// -------------------------------------------------------

const DB_NAME = 'SecureTeam_KeyStore';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Guarda un valor en el almacenamiento local seguro.
 */
export async function saveToKeyStore(key: string, value: unknown): Promise<void> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Lee un valor del almacenamiento local seguro.
 */
export async function loadFromKeyStore<T>(key: string): Promise<T | null> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Elimina un valor del almacenamiento local.
 */
export async function deleteFromKeyStore(key: string): Promise<void> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Limpia todo el almacenamiento de claves.
 * Útil al cerrar sesión.
 */
export async function clearKeyStore(): Promise<void> {
  const db = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// -------------------------------------------------------
// Fingerprint de clave (para verificación visual)
// -------------------------------------------------------

/**
 * Genera un "fingerprint" legible de una clave pública.
 * Se muestra al usuario para verificación manual.
 * Ejemplo: "A1B2 C3D4 E5F6 7890 ABCD"
 */
export async function generateFingerprint(publicKeyBase64: string): Promise<string> {
  const raw = base64ToArrayBuffer(publicKeyBase64);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  const bytes = new Uint8Array(hash);

  // Tomar los primeros 20 bytes y formatear en grupos de 4 hex
  const hex = Array.from(bytes.slice(0, 20))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  return hex.match(/.{4}/g)!.join(' ');
}

// -------------------------------------------------------
// Utilidades de conversión
// -------------------------------------------------------

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function concatArrayBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    result.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }
  return result.buffer;
}
