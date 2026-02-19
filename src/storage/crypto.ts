const PBKDF2_ITERATIONS = 310000;
const SALT = new TextEncoder().encode('ei-the-answer-is-42');
const ID_PLAINTEXT = 'the_answer_is_42';
const CHUNK_SIZE = 0x8000; // 32KB chunks for base64 conversion

export interface CryptoCredentials {
  username: string;
  passphrase: string;
}

export interface EncryptedPayload {
  iv: string;
  ciphertext: string;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

async function deriveKey(credentials: CryptoCredentials): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${credentials.username}:${credentials.passphrase}`),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateUserId(credentials: CryptoCredentials): Promise<string> {
  const key = await deriveKey(credentials);
  // Fixed IV for deterministic user ID - same credentials = same ID
  // This is safe because we only ever encrypt the same static plaintext
  const iv = new Uint8Array(12);  // All zeros - deterministic

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(ID_PLAINTEXT)
  );

  return btoa(String.fromCharCode(...new Uint8Array(ciphertext)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export async function encrypt(data: string, credentials: CryptoCredentials): Promise<EncryptedPayload> {
  const key = await deriveKey(credentials);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data)
  );

  return {
    iv: uint8ArrayToBase64(iv),
    ciphertext: uint8ArrayToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decrypt(payload: EncryptedPayload, credentials: CryptoCredentials): Promise<string> {
  const key = await deriveKey(credentials);

  const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(payload.ciphertext), c => c.charCodeAt(0));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
