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

  // In development, generate a random key persisted to disk so it survives restarts
  // but is never committed to git (var/ is gitignored).
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const keyPath = path.resolve(process.cwd(), 'var', '.dev-encryption-key');

  try {
    const existing = fs.readFileSync(keyPath, 'utf8').trim();
    if (existing.length >= 32) {
      return crypto.createHash('sha256').update(existing).digest();
    }
  } catch {
    // Key file doesn't exist yet -- generate one.
  }

  // Guard: refuse to generate a new key if encrypted values already exist in the DB.
  // Silently generating a new key would make existing secrets permanently unreadable.
  try {
    const dbRaw = (process.env.X_MANAGER_DB_PATH || '').trim() || 'var/x-manager.sqlite.db';
    const dbResolved = path.isAbsolute(dbRaw) ? dbRaw : path.join(process.cwd(), dbRaw);
    if (fs.existsSync(dbResolved)) {
      const BetterSqlite3 = require('better-sqlite3') as typeof import('better-sqlite3').default;
      const checkDb = new BetterSqlite3(dbResolved, { readonly: true, timeout: 2000 });
      try {
        const row = checkDb.prepare(
          "SELECT 1 FROM app_settings WHERE setting_value LIKE 'enc:v1:%' LIMIT 1",
        ).get();
        if (row) {
          throw new Error(
            '[crypto-store] FATAL: Encrypted secrets exist in the database but the dev encryption key ' +
            'file is missing or invalid (var/.dev-encryption-key). Generating a new key would make ' +
            'existing secrets unreadable. Restore the key file or re-encrypt secrets with the current key.',
          );
        }
      } finally {
        checkDb.close();
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('FATAL')) throw err;
    // DB doesn't exist yet or can't be read -- safe to generate a new key.
  }

  try {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    const randomKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, randomKey, { mode: 0o600 });
    console.warn('[crypto-store] Generated new dev encryption key at var/.dev-encryption-key');
    return crypto.createHash('sha256').update(randomKey).digest();
  } catch (err) {
    console.warn('[crypto-store] Could not persist dev encryption key, using ephemeral key:', err);
    return crypto.randomBytes(32);
  }
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
