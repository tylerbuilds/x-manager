import { NextResponse } from 'next/server';
import { XM_SESSION_COOKIE, createSessionValue, getAdminToken, isAuthRequired } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LoginBody = {
  token?: unknown;
};

function normalizeToken(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

import crypto from 'crypto';

export async function POST(req: Request) {
  if (!isAuthRequired()) {
    return NextResponse.json({ ok: true, authRequired: false, authenticated: true });
  }

  const adminToken = getAdminToken();
  if (!adminToken) {
    return NextResponse.json(
      { error: 'Auth is required but X_MANAGER_ADMIN_TOKEN is missing.' },
      { status: 503 },
    );
  }

  let body: LoginBody = {};
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    body = {};
  }

  const providedToken = normalizeToken(body.token);
  if (!providedToken || !constantTimeEqual(providedToken, adminToken)) {
    return NextResponse.json({ error: 'Invalid admin token.' }, { status: 401 });
  }

  const sessionValue = createSessionValue(adminToken);
  const maxAge = Math.max(300, Number(process.env.X_MANAGER_SESSION_TTL_SECONDS || 60 * 60 * 12));

  const response = NextResponse.json({ ok: true, authRequired: true, authenticated: true });
  response.cookies.set(XM_SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });

  return response;
}
