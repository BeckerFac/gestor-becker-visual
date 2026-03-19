import crypto from 'crypto';

/**
 * Application-level field encryption utility.
 *
 * Uses AES-256-GCM for authenticated encryption of sensitive fields
 * (CUIT, bank account numbers, etc.).
 *
 * Rationale for application-level over pgcrypto:
 * - 8-12% overhead vs 18-25% for pgcrypto (context switching)
 * - Key never leaves the application layer (DB admins can't see plaintext)
 * - Portable across databases
 * - Easier to rotate keys
 *
 * The encryption key must be 32 bytes (256 bits) and provided via
 * the ENCRYPTION_KEY environment variable as a hex-encoded string.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag
const ENCODING = 'hex';

// Prefix to identify encrypted values (avoids double-encryption)
const ENCRYPTED_PREFIX = 'enc:v1:';

/**
 * Get the encryption key from environment.
 * Returns null if not configured (encryption disabled).
 */
function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex) {
    return null;
  }

  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters). ' +
      `Got ${key.length} bytes. Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"`,
    );
  }

  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns the encrypted value prefixed with 'enc:v1:' for identification.
 * If ENCRYPTION_KEY is not set, returns the plaintext unchanged (graceful degradation).
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;

  // Already encrypted - don't double-encrypt
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) {
    return plaintext;
  }

  const key = getEncryptionKey();
  if (!key) {
    // Encryption not configured - return plaintext
    // Log warning only once per process
    if (!encryptWarned) {
      console.warn('SECURITY WARNING: ENCRYPTION_KEY not set. Sensitive fields are stored in plaintext.');
      encryptWarned = true;
    }
    return plaintext;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plaintext, 'utf8', ENCODING);
  encrypted += cipher.final(ENCODING);

  const authTag = cipher.getAuthTag();

  // Format: enc:v1:{iv}:{authTag}:{ciphertext}
  return `${ENCRYPTED_PREFIX}${iv.toString(ENCODING)}:${authTag.toString(ENCODING)}:${encrypted}`;
}

let encryptWarned = false;

/**
 * Decrypt an encrypted field.
 * If the value doesn't have the encrypted prefix, returns it as-is
 * (handles migration from unencrypted to encrypted data).
 */
export function decryptField(encrypted: string): string {
  if (!encrypted) return encrypted;

  // Not encrypted - return as-is (backward compatibility)
  if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
    return encrypted;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error(
      'Cannot decrypt: ENCRYPTION_KEY environment variable is not set. ' +
      'Data was encrypted but the key is missing.',
    );
  }

  const payload = encrypted.slice(ENCRYPTED_PREFIX.length);
  const parts = payload.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted field format');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const iv = Buffer.from(ivHex, ENCODING);
  const authTag = Buffer.from(authTagHex, ENCODING);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, ENCODING, 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a value is already encrypted.
 */
export function isEncrypted(value: string): boolean {
  return value?.startsWith(ENCRYPTED_PREFIX) ?? false;
}

/**
 * Encrypt multiple fields in an object.
 * Returns a new object with specified fields encrypted.
 */
export function encryptFields<T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      (result as any)[field] = encryptField(value);
    }
  }
  return result;
}

/**
 * Decrypt multiple fields in an object.
 * Returns a new object with specified fields decrypted.
 */
export function decryptFields<T extends Record<string, any>>(
  obj: T,
  fieldNames: (keyof T)[],
): T {
  const result = { ...obj };
  for (const field of fieldNames) {
    const value = result[field];
    if (typeof value === 'string' && value.length > 0) {
      (result as any)[field] = decryptField(value);
    }
  }
  return result;
}

/**
 * Generate a new encryption key (utility for setup).
 * Prints to stdout. Run with: npx tsx -e "require('./src/lib/encryption').generateKey()"
 */
export function generateKey(): string {
  const key = crypto.randomBytes(32).toString('hex');
  console.log('Generated ENCRYPTION_KEY:', key);
  console.log('Add to your .env file: ENCRYPTION_KEY=' + key);
  return key;
}
