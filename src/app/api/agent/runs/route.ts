import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentRuns } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const campaignId = url.searchParams.get('campaign_id');
    const status = url.searchParams.get('status');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    let query = db.select().from(agentRuns);

    if (campaignId) {
      const id = Number.parseInt(campaignId, 10);
      if (Number.isFinite(id)) {
        query = query.where(eq(agentRuns.campaignId, id)) as typeof query;
      }
    }

    if (status) {
      query = query.where(eq(agentRuns.status, status as 'running' | 'completed' | 'failed' | 'cancelled')) as typeof query;
    }

    const rows = await query.orderBy(desc(agentRuns.startedAt)).limit(limit);
    return NextResponse.json({ runs: rows });
  } catch (error) {
    console.error('Failed to list agent runs:', error);
    return NextResponse.json({ error: 'Failed to list runs.' }, { status: 500 });
  }
}
