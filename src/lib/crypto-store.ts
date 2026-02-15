import crypto from 'crypto';

const ENCRYPTED_PREFIX = 'enc:v1:';

function deriveKeyFromConfig(): Buffer | null {
  const configured = (process.env.X_MANAGER_ENCRYPTION_KEY || '').trim();
  if (configured) {
    if (/^[A-Fa-f0-9]{64}$/.test(configured)) {
      return Buffer.from(configured, 'hex');
    }

    try {
      const decoded = Buffer.from(configured, 'base64');
      if (decoded.length === 32) {
        return decoded;
      }
    } catch {
      // Fall through to hash-based derivation.
    }

    return crypto.createHash('sha256').update(configured).digest();
  }

  const adminToken = (process.env.X_MANAGER_ADMIN_TOKEN || '').trim();
  if (adminToken) {
    return crypto.createHash('sha256').update(`x-manager|admin-token|${adminToken}`).digest();
  }

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return crypto.createHash('sha256').update('x-manager-dev-fallback-key').digest();
}

function requireEncryptionKey(): Buffer {
  const key = deriveKeyFromConfig();
  if (!key) {
    throw new Error(
      'Missing encryption key. Set X_MANAGER_ENCRYPTION_KEY (or X_MANAGER_ADMIN_TOKEN) to enable secret decryption.',
    );
  }
  return key;
}

export function canEncryptSecrets(): boolean {
  return deriveKeyFromConfig() !== null;
}

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptValue(value: string): string {
  if (!value) return value;
  if (isEncryptedValue(value)) return value;

  const key = requireEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptValue(value: string): string {
  if (!isEncryptedValue(value)) return value;

  const key = requireEncryptionKey();
  const raw = value.slice(ENCRYPTED_PREFIX.length);
  const [ivRaw, tagRaw, encryptedRaw] = raw.split(':');
  if (!ivRaw || !tagRaw || !encryptedRaw) {
    throw new Error('Invalid encrypted secret format.');
  }

  const iv = Buffer.from(ivRaw, 'base64url');
  const tag = Buffer.from(tagRaw, 'base64url');
  const encrypted = Buffer.from(encryptedRaw, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export function decryptValueIfPresent(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return decryptValue(value);
}
