import { desc, eq, and, gte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, sqlite } from '@/lib/db';
import { xApiCalls } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountSlot = url.searchParams.get('account_slot');
    const hours = Math.min(720, Math.max(1, Number(url.searchParams.get('hours') || 24)));
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));

    const sinceEpoch = Math.floor(Date.now() / 1000) - hours * 3600;

    const conditions = [gte(xApiCalls.createdAt, new Date(sinceEpoch * 1000))];
    if (accountSlot) {
      const slot = Number.parseInt(accountSlot, 10);
      if (slot === 1 || slot === 2) {
        conditions.push(eq(xApiCalls.accountSlot, slot));
      }
    }

    const rows = await db
      .select()
      .from(xApiCalls)
      .where(and(...conditions))
      .orderBy(desc(xApiCalls.createdAt))
      .limit(limit);

    // Aggregate summary
    const summary = sqlite.prepare(`
      SELECT
        account_slot,
        COUNT(*) as total_calls,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as success_count,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN status_code = 429 THEN 1 ELSE 0 END) as rate_limited_count,
        ROUND(AVG(duration_ms), 0) as avg_duration_ms
      FROM x_api_calls
      WHERE created_at >= ?
      ${accountSlot ? 'AND account_slot = ?' : ''}
      GROUP BY account_slot
    `).all(...(accountSlot ? [sinceEpoch, Number(accountSlot)] : [sinceEpoch])) as Array<{
      account_slot: number;
      total_calls: number;
      success_count: number;
      error_count: number;
      rate_limited_count: number;
      avg_duration_ms: number;
    }>;

    return NextResponse.json({ calls: rows, summary, period_hours: hours });
  } catch (error) {
    console.error('Failed to list API calls:', error);
    return NextResponse.json({ error: 'Failed to list API calls.' }, { status: 500 });
  }
}
