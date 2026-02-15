import crypto from 'crypto';
import type { NextRequest } from 'next/server';

export const XM_SESSION_COOKIE = 'x_manager_session';
const SESSION_VERSION = 'v1';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

const PUBLIC_API_PREFIXES = [
  '/api/system/auth/login',
  '/api/system/auth/logout',
  '/api/system/auth/session',
  '/api/twitter/auth/callback',
];

function stableTrim(value: string | undefined): string {
  return (value || '').trim();
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  const pieces = header.split(';');
  for (const piece of pieces) {
    const index = piece.indexOf('=');
    if (index <= 0) continue;
    const key = piece.slice(0, index).trim();
    const value = piece.slice(index + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function adminTokenFingerprint(adminToken: string): string {
  return crypto.createHash('sha256').update(`admin-token:${adminToken}`).digest('hex').slice(0, 16);
}

function getSessionSecret(): string {
  return stableTrim(process.env.X_MANAGER_SESSION_SECRET)
    || stableTrim(process.env.X_MANAGER_ENCRYPTION_KEY)
    || stableTrim(process.env.X_MANAGER_ADMIN_TOKEN);
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export function getAdminToken(): string {
  return stableTrim(process.env.X_MANAGER_ADMIN_TOKEN);
}

export function isAuthRequired(): boolean {
  const explicit = stableTrim(process.env.X_MANAGER_REQUIRE_AUTH).toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return getAdminToken().length > 0;
}

export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function createSessionValue(adminToken: string): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('Missing session secret. Configure X_MANAGER_SESSION_SECRET or X_MANAGER_ADMIN_TOKEN.');
  }

  const ttl = Math.max(300, Number(process.env.X_MANAGER_SESSION_TTL_SECONDS || DEFAULT_SESSION_TTL_SECONDS));
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    v: SESSION_VERSION,
    iat: now,
    exp: now + ttl,
    tf: adminTokenFingerprint(adminToken),
  }), 'utf8').toString('base64url');
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

export function verifySessionValue(raw: string, adminToken: string): boolean {
  if (!raw || !adminToken) return false;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return false;

  const secret = getSessionSecret();
  if (!secret) return false;
  const expectedSignature = signPayload(payload, secret);
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      v?: string;
      exp?: number;
      tf?: string;
    };
    if (parsed.v !== SESSION_VERSION) return false;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return false;
    if (parsed.tf !== adminTokenFingerprint(adminToken)) return false;
    return true;
  } catch {
    return false;
  }
}

export function requestHasValidAuth(req: Request | NextRequest): boolean {
  if (!isAuthRequired()) return true;

  const adminToken = getAdminToken();
  if (!adminToken) return false;

  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1] && constantTimeEqual(match[1].trim(), adminToken)) {
      return true;
    }
  }

  const cookies = parseCookies(req.headers.get('cookie'));
  const sessionValue = cookies[XM_SESSION_COOKIE];
  if (sessionValue && verifySessionValue(sessionValue, adminToken)) {
    return true;
  }

  return false;
}
