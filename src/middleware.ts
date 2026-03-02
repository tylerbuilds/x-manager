import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { logger } from './lib/logger';

const log = logger('http');
const XM_SESSION_COOKIE = 'x_manager_session';
const SESSION_VERSION = 'v1';

const PUBLIC_API_PREFIXES = [
  '/api/system/auth/login',
  '/api/system/auth/logout',
  '/api/system/auth/session',
  '/api/twitter/auth/callback',
  '/api/r/',
];

const GLOBAL_RATE_LIMIT_PER_MIN = 120;

type RateBucket = { minute: number; count: number };
const globalRateBuckets = new Map<string, RateBucket>();

function getClientIpFromRequest(req: NextRequest): string {
  // H6 fix: Only trust proxy headers when explicitly configured
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
      const ip = forwarded.split(',')[0]?.trim();
      if (ip) return ip;
    }
    const realIp = req.headers.get('x-real-ip');
    if (realIp) return realIp.trim();
  }
  return (req as NextRequest & { ip?: string }).ip || 'local';
}

function checkGlobalRate(req: NextRequest): { ok: boolean; retryAfter: number } {
  const minute = Math.floor(Date.now() / 60_000);
  const ip = getClientIpFromRequest(req);

  // Prune old entries
  if (globalRateBuckets.size > 4096) {
    for (const [key, bucket] of globalRateBuckets.entries()) {
      if (bucket.minute < minute - 2) {
        globalRateBuckets.delete(key);
      }
    }
  }

  const existing = globalRateBuckets.get(ip);
  if (!existing || existing.minute !== minute) {
    globalRateBuckets.set(ip, { minute, count: 1 });
    return { ok: true, retryAfter: 0 };
  }

  if (existing.count >= GLOBAL_RATE_LIMIT_PER_MIN) {
    const elapsed = Math.floor((Date.now() % 60_000) / 1000);
    return { ok: false, retryAfter: Math.max(1, 60 - elapsed) };
  }

  existing.count += 1;
  return { ok: true, retryAfter: 0 };
}

function stableTrim(value: string | undefined): string {
  return (value || '').trim();
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

function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function getAdminToken(): string {
  return stableTrim(process.env.X_MANAGER_ADMIN_TOKEN);
}

function isAuthRequired(): boolean {
  const explicit = stableTrim(process.env.X_MANAGER_REQUIRE_AUTH).toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  // H2 fix: In production, default to requiring auth even without a token.
  // This prevents accidentally running wide-open in production.
  if (process.env.NODE_ENV === 'production') return true;
  return getAdminToken().length > 0;
}

// H3 fix: Derive session secret via HMAC so it's cryptographically distinct from the admin token.
// This prevents Bearer token holders from trivially forging session cookies.
let _derivedSessionSecret: string | null = null;
async function getSessionSecret(): Promise<string> {
  const explicit = stableTrim(process.env.X_MANAGER_SESSION_SECRET);
  if (explicit) return explicit;

  const baseKey = stableTrim(process.env.X_MANAGER_ENCRYPTION_KEY)
    || stableTrim(process.env.X_MANAGER_ADMIN_TOKEN);
  if (!baseKey) return '';

  if (!_derivedSessionSecret) {
    _derivedSessionSecret = await hmacSha256Hex(baseKey, 'x-manager:session-signing-key:v1');
  }
  return _derivedSessionSecret;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function decodeBase64Url(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return toHex(digest);
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toHex(signature);
}

async function adminTokenFingerprint(adminToken: string): Promise<string> {
  const hash = await sha256Hex(`admin-token:${adminToken}`);
  return hash.slice(0, 16);
}

async function verifySessionValue(raw: string, adminToken: string): Promise<boolean> {
  if (!raw || !adminToken) return false;
  const [payload, signature] = raw.split('.');
  if (!payload || !signature) return false;

  const secret = await getSessionSecret();
  if (!secret) return false;

  const expectedSignature = await hmacSha256Hex(secret, payload);
  if (!constantTimeEqual(signature, expectedSignature)) return false;

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as {
      v?: string;
      exp?: number;
      tf?: string;
    };
    if (parsed.v !== SESSION_VERSION) return false;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return false;
    if (parsed.tf !== await adminTokenFingerprint(adminToken)) return false;
    return true;
  } catch {
    return false;
  }
}

async function requestHasValidAuth(req: NextRequest): Promise<boolean> {
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
  if (sessionValue && await verifySessionValue(sessionValue, adminToken)) {
    return true;
  }

  return false;
}

function logRequest(method: string, path: string, status: number, ms: number, ip: string): void {
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  log[level]('request', { method, path, status, ms, ip });
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const start = Date.now();
  const method = req.method;
  const ip = getClientIpFromRequest(req);

  if (isPublicApiPath(pathname)) {
    logRequest(method, pathname, 200, Date.now() - start, ip);
    return NextResponse.next();
  }

  // Global rate limiting
  const rate = checkGlobalRate(req);
  if (!rate.ok) {
    logRequest(method, pathname, 429, Date.now() - start, ip);
    return NextResponse.json(
      { error: 'Too many requests.', code: 'RATE_LIMIT_EXCEEDED' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(rate.retryAfter),
        },
      },
    );
  }

  if (!isAuthRequired()) {
    logRequest(method, pathname, 200, Date.now() - start, ip);
    return NextResponse.next();
  }

  if (!getAdminToken()) {
    logRequest(method, pathname, 503, Date.now() - start, ip);
    return NextResponse.json(
      { error: 'Auth is required but X_MANAGER_ADMIN_TOKEN is not configured.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  if (await requestHasValidAuth(req)) {
    logRequest(method, pathname, 200, Date.now() - start, ip);
    return NextResponse.next();
  }

  logRequest(method, pathname, 401, Date.now() - start, ip);
  return NextResponse.json(
    {
      error: 'Unauthorized.',
      hint: 'Authenticate via /api/system/auth/login or send Authorization: Bearer <X_MANAGER_ADMIN_TOKEN>.',
    },
    {
      status: 401,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export const config = {
  matcher: ['/api/:path*'],
};
