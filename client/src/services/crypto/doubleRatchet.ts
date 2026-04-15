// ============================================================
// SecureTeam — Double Ratchet (Doble Engranaje)
// Proporciona "forward secrecy" y "break-in recovery":
// - Si alguien roba una clave, NO puede leer mensajes pasados
// - Después de unos mensajes, tampoco puede leer los futuros
//
// Basado en: https://signal.org/docs/specifications/doubleratchet/
//
// ¿Cómo funciona? (explicación simple):
// Imagina dos engranajes que giran cada vez que envías un mensaje.
// Cada giro genera una clave nueva. La clave anterior se destruye.
// Así, cada mensaje tiene su propia clave única e irrepetible.
// ============================================================

import {
  generateECDHKeyPair,
  importPublicKeyECDH,
  exportPublicKey,
  arrayBufferToBase64,
  base64ToArrayBuffer,
} from './keys.js';

// -------------------------------------------------------
// Tipos
// -------------------------------------------------------

interface RatchetState {
  // DH Ratchet (engranaje Diffie-Hellman)
  dhKeyPair: CryptoKeyPair;          // Nuestro par DH actual
  remoteDHPublicKey: CryptoKey | null; // Clave DH pública remota

  // Symmetric Ratchet (engranaje simétrico)
  rootKey: ArrayBuffer;               // Clave raíz (se actualiza con cada DH ratchet)
  sendChainKey: ArrayBuffer | null;    // Cadena de envío
  recvChainKey: ArrayBuffer | null;    // Cadena de recepción

  // Contadores
  sendMessageNumber: number;
  recvMessageNumber: number;
  previousSendChainLength: number;

  // Cache de claves de mensajes perdidos (para mensajes fuera de orden)
  skippedMessageKeys: Map<string, ArrayBuffer>;
}

interface EncryptedMessage {
  ciphertext: string;      // Base64
  iv: string;              // Base64
  dhPublicKey: string;     // Base64 - nuestra clave DH pública actual
  messageNumber: number;
  previousChainLength: number;
}

// -------------------------------------------------------
// Constantes
// -------------------------------------------------------

const MAX_SKIP = 100; // Máximo de mensajes que se pueden saltar

// -------------------------------------------------------
// HKDF para derivación de claves
// -------------------------------------------------------

async function hkdfDerive(
  inputKey: ArrayBuffer,
  salt: ArrayBuffer,
  info: string,
  length: number = 32
): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    inputKey,
    'HKDF',
    false,
    ['deriveBits']
  );

  return crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(info),
    },
    keyMaterial,
    length * 8
  );
}

/**
 * KDF para la cadena raíz:
 * rootKey + DH output → nuevo rootKey + chainKey
 */
async function kdfRootKey(
  rootKey: ArrayBuffer,
  dhOutput: ArrayBuffer
): Promise<{ newRootKey: ArrayBuffer; chainKey: ArrayBuffer }> {
  const derived = await hkdfDerive(
    dhOutput,
    rootKey,
    'SecureTeam_RootChain',
    64 // 32 bytes para rootKey + 32 bytes para chainKey
  );

  return {
    newRootKey: derived.slice(0, 32),
    chainKey: derived.slice(32, 64),
  };
}

/**
 * KDF para la cadena de mensajes:
 * chainKey → nuevo chainKey + messageKey
 */
async function kdfChainKey(
  chainKey: ArrayBuffer
): Promise<{ newChainKey: ArrayBuffer; messageKey: ArrayBuffer }> {
  const hmacKey = await crypto.subtle.importKey(
    'raw',
    chainKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const chainKeyBuffer = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new Uint8Array([0x01])
  );

  const messageKeyBuffer = await crypto.subtle.sign(
    'HMAC',
    hmacKey,
    new Uint8Array([0x02])
  );

  return {
    newChainKey: chainKeyBuffer,
    messageKey: messageKeyBuffer,
  };
}

// -------------------------------------------------------
// Diffie-Hellman
// -------------------------------------------------------

async function dhExchange(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256
  );
}

// -------------------------------------------------------
// Cifrado / Descifrado AES-GCM
// -------------------------------------------------------

async function encryptAESGCM(
  plaintext: string,
  key: ArrayBuffer,
  associatedData?: ArrayBuffer
): Promise<{ ciphertext: ArrayBuffer; iv: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-GCM',
    false,
    ['encrypt']
  );

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: associatedData,
      tagLength: 128,
    },
    aesKey,
    new TextEncoder().encode(plaintext)
  );

  return { ciphertext, iv: iv.buffer };
}

async function decryptAESGCM(
  ciphertext: ArrayBuffer,
  key: ArrayBuffer,
  iv: ArrayBuffer,
  associatedData?: ArrayBuffer
): Promise<string> {
  const aesKey = await crypto.subtle.importKey(
    'raw',
    key,
    'AES-GCM',
    false,
    ['decrypt']
  );

  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: associatedData,
      tagLength: 128,
    },
    aesKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintext);
}

// -------------------------------------------------------
// Clase Double Ratchet
// -------------------------------------------------------

export class DoubleRatchet {
  private state: RatchetState;

  private constructor(state: RatchetState) {
    this.state = state;
  }

  /**
   * Inicializar como EMISOR del primer mensaje.
   * Se usa después de X3DH cuando Alice envía a Bob.
   */
  static async initAsSender(
    sharedSecret: ArrayBuffer,
    remoteDHPublicKeyBase64: string
  ): Promise<DoubleRatchet> {
    const dhKeyPair = await generateECDHKeyPair();
    const remoteDHPublicKey = await importPublicKeyECDH(remoteDHPublicKeyBase64);

    // Primer DH ratchet
    const dhOutput = await dhExchange(dhKeyPair.privateKey, remoteDHPublicKey);
    const { newRootKey, chainKey } = await kdfRootKey(sharedSecret, dhOutput);

    const state: RatchetState = {
      dhKeyPair,
      remoteDHPublicKey,
      rootKey: newRootKey,
      sendChainKey: chainKey,
      recvChainKey: null,
      sendMessageNumber: 0,
      recvMessageNumber: 0,
      previousSendChainLength: 0,
      skippedMessageKeys: new Map(),
    };

    return new DoubleRatchet(state);
  }

  /**
   * Inicializar como RECEPTOR del primer mensaje.
   * Se usa después de X3DH cuando Bob recibe de Alice.
   */
  static async initAsReceiver(
    sharedSecret: ArrayBuffer,
    dhKeyPair: CryptoKeyPair
  ): Promise<DoubleRatchet> {
    const state: RatchetState = {
      dhKeyPair,
      remoteDHPublicKey: null,
      rootKey: sharedSecret,
      sendChainKey: null,
      recvChainKey: null,
      sendMessageNumber: 0,
      recvMessageNumber: 0,
      previousSendChainLength: 0,
      skippedMessageKeys: new Map(),
    };

    return new DoubleRatchet(state);
  }

  /**
   * Cifrar un mensaje.
   * Cada mensaje usa una clave diferente (forward secrecy).
   */
  async encrypt(plaintext: string): Promise<EncryptedMessage> {
    if (!this.state.sendChainKey) {
      throw new Error('No se puede cifrar: cadena de envío no inicializada');
    }

    // Avanzar cadena de envío
    const { newChainKey, messageKey } = await kdfChainKey(this.state.sendChainKey);
    this.state.sendChainKey = newChainKey;

    // Cifrar con AES-GCM
    const { ciphertext, iv } = await encryptAESGCM(plaintext, messageKey);

    const dhPublicKey = await exportPublicKey(this.state.dhKeyPair.publicKey);
    const messageNumber = this.state.sendMessageNumber;
    const previousChainLength = this.state.previousSendChainLength;

    this.state.sendMessageNumber++;

    return {
      ciphertext: arrayBufferToBase64(ciphertext),
      iv: arrayBufferToBase64(iv),
      dhPublicKey,
      messageNumber,
      previousChainLength,
    };
  }

  /**
   * Descifrar un mensaje recibido.
   * Detecta si hay un nuevo DH ratchet y actualiza el estado.
   */
  async decrypt(message: EncryptedMessage): Promise<string> {
    // Intentar usar clave en cache (mensajes fuera de orden)
    const skippedKey = `${message.dhPublicKey}:${message.messageNumber}`;
    const cachedKey = this.state.skippedMessageKeys.get(skippedKey);

    if (cachedKey) {
      this.state.skippedMessageKeys.delete(skippedKey);
      return decryptAESGCM(
        base64ToArrayBuffer(message.ciphertext),
        cachedKey,
        base64ToArrayBuffer(message.iv)
      );
    }

    // ¿Nuevo DH ratchet? (la clave DH del emisor cambió)
    const currentRemoteDH = this.state.remoteDHPublicKey
      ? await exportPublicKey(this.state.remoteDHPublicKey)
      : null;

    if (message.dhPublicKey !== currentRemoteDH) {
      // Guardar claves de mensajes que nos saltamos
      if (this.state.recvChainKey) {
        await this.skipMessageKeys(
          this.state.recvChainKey,
          message.previousChainLength - this.state.recvMessageNumber,
          currentRemoteDH || ''
        );
      }

      // Ejecutar DH ratchet
      const newRemoteDHPublicKey = await importPublicKeyECDH(message.dhPublicKey);

      // Derivar nueva cadena de recepción
      const dhOutput = await dhExchange(
        this.state.dhKeyPair.privateKey,
        newRemoteDHPublicKey
      );
      const { newRootKey, chainKey: recvChainKey } = await kdfRootKey(
        this.state.rootKey,
        dhOutput
      );

      // Nueva clave DH propia
      const newDHKeyPair = await generateECDHKeyPair();
      const dhOutput2 = await dhExchange(
        newDHKeyPair.privateKey,
        newRemoteDHPublicKey
      );
      const { newRootKey: newRootKey2, chainKey: sendChainKey } = await kdfRootKey(
        newRootKey,
        dhOutput2
      );

      this.state.remoteDHPublicKey = newRemoteDHPublicKey;
      this.state.dhKeyPair = newDHKeyPair;
      this.state.rootKey = newRootKey2;
      this.state.recvChainKey = recvChainKey;
      this.state.sendChainKey = sendChainKey;
      this.state.previousSendChainLength = this.state.sendMessageNumber;
      this.state.sendMessageNumber = 0;
      this.state.recvMessageNumber = 0;
    }

    // Guardar claves de mensajes saltados en la cadena actual
    if (this.state.recvChainKey) {
      const toSkip = message.messageNumber - this.state.recvMessageNumber;
      if (toSkip > 0) {
        await this.skipMessageKeys(
          this.state.recvChainKey,
          toSkip,
          message.dhPublicKey
        );
      }
    }

    // Avanzar cadena de recepción
    if (!this.state.recvChainKey) {
      throw new Error('No se puede descifrar: cadena de recepción no inicializada');
    }

    const { newChainKey, messageKey } = await kdfChainKey(this.state.recvChainKey);
    this.state.recvChainKey = newChainKey;
    this.state.recvMessageNumber = message.messageNumber + 1;

    return decryptAESGCM(
      base64ToArrayBuffer(message.ciphertext),
      messageKey,
      base64ToArrayBuffer(message.iv)
    );
  }

  /**
   * Guardar claves de mensajes que nos saltamos
   * (para descifrar si llegan después, fuera de orden)
   */
  private async skipMessageKeys(
    chainKey: ArrayBuffer,
    count: number,
    dhPublicKey: string
  ): Promise<void> {
    if (count > MAX_SKIP) {
      throw new Error(
        `Demasiados mensajes saltados (${count}). Posible ataque o desincronización.`
      );
    }

    let currentChainKey = chainKey;
    for (let i = 0; i < count; i++) {
      const { newChainKey, messageKey } = await kdfChainKey(currentChainKey);
      const key = `${dhPublicKey}:${this.state.recvMessageNumber + i}`;
      this.state.skippedMessageKeys.set(key, messageKey);
      currentChainKey = newChainKey;
    }
    this.state.recvChainKey = currentChainKey;
  }

  /**
   * Exportar estado para guardar en IndexedDB.
   */
  async exportState(): Promise<string> {
    const dhPublicKey = await exportPublicKey(this.state.dhKeyPair.publicKey);
    const dhPrivateKeyJwk = await crypto.subtle.exportKey('jwk', this.state.dhKeyPair.privateKey);

    let remoteDHPublicKeyBase64: string | null = null;
    if (this.state.remoteDHPublicKey) {
      remoteDHPublicKeyBase64 = await exportPublicKey(this.state.remoteDHPublicKey);
    }

    const skipped: Record<string, string> = {};
    for (const [k, v] of this.state.skippedMessageKeys) {
      skipped[k] = arrayBufferToBase64(v);
    }

    return JSON.stringify({
      dhPublicKey,
      dhPrivateKeyJwk,
      remoteDHPublicKeyBase64,
      rootKey: arrayBufferToBase64(this.state.rootKey),
      sendChainKey: this.state.sendChainKey
        ? arrayBufferToBase64(this.state.sendChainKey)
        : null,
      recvChainKey: this.state.recvChainKey
        ? arrayBufferToBase64(this.state.recvChainKey)
        : null,
      sendMessageNumber: this.state.sendMessageNumber,
      recvMessageNumber: this.state.recvMessageNumber,
      previousSendChainLength: this.state.previousSendChainLength,
      skippedMessageKeys: skipped,
    });
  }

  /**
   * Restaurar estado desde IndexedDB.
   */
  static async importState(serialized: string): Promise<DoubleRatchet> {
    const data = JSON.parse(serialized);

    const dhPrivateKey = await crypto.subtle.importKey(
      'jwk',
      data.dhPrivateKeyJwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      ['deriveBits']
    );
    const dhPublicKey = await importPublicKeyECDH(data.dhPublicKey);

    let remoteDHPublicKey: CryptoKey | null = null;
    if (data.remoteDHPublicKeyBase64) {
      remoteDHPublicKey = await importPublicKeyECDH(data.remoteDHPublicKeyBase64);
    }

    const skippedMessageKeys = new Map<string, ArrayBuffer>();
    for (const [k, v] of Object.entries(data.skippedMessageKeys)) {
      skippedMessageKeys.set(k, base64ToArrayBuffer(v as string));
    }

    const state: RatchetState = {
      dhKeyPair: { publicKey: dhPublicKey, privateKey: dhPrivateKey },
      remoteDHPublicKey,
      rootKey: base64ToArrayBuffer(data.rootKey),
      sendChainKey: data.sendChainKey
        ? base64ToArrayBuffer(data.sendChainKey)
        : null,
      recvChainKey: data.recvChainKey
        ? base64ToArrayBuffer(data.recvChainKey)
        : null,
      sendMessageNumber: data.sendMessageNumber,
      recvMessageNumber: data.recvMessageNumber,
      previousSendChainLength: data.previousSendChainLength,
      skippedMessageKeys,
    };

    return new DoubleRatchet(state);
  }
}
