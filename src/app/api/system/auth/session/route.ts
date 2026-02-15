import { NextResponse } from 'next/server';
import { isAuthRequired, requestHasValidAuth } from '@/lib/api-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authRequired = isAuthRequired();
  const authenticated = authRequired ? requestHasValidAuth(req) : true;

  return NextResponse.json({
    authRequired,
    authenticated,
  });
}
