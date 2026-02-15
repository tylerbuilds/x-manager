import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const XM_SESSION_COOKIE = 'x_manager_session';
const SESSION_VERSION = 'v1';

const PUBLIC_API_PREFIXES = [
  '/api/system/auth/login',
  '/api/system/auth/logout',
  '/api/system/auth/session',
  '/api/twitter/auth/callback',
];

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
  return getAdminToken().length > 0;
}

function getSessionSecret(): string {
  return stableTrim(process.env.X_MANAGER_SESSION_SECRET)
    || stableTrim(process.env.X_MANAGER_ENCRYPTION_KEY)
    || stableTrim(process.env.X_MANAGER_ADMIN_TOKEN);
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

  const secret = getSessionSecret();
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (isPublicApiPath(pathname)) {
    return NextResponse.next();
  }

  if (!isAuthRequired()) {
    return NextResponse.next();
  }

  if (!getAdminToken()) {
    return NextResponse.json(
      { error: 'Auth is required but X_MANAGER_ADMIN_TOKEN is not configured.' },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  if (await requestHasValidAuth(req)) {
    return NextResponse.next();
  }

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
