import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { automationRuleRuns } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ruleId = Number.parseInt(id, 10);
    if (!Number.isFinite(ruleId) || ruleId <= 0) {
      return NextResponse.json({ error: 'Invalid rule id.' }, { status: 400 });
    }

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const conditions = [eq(automationRuleRuns.ruleId, ruleId)];
    if (status) {
      conditions.push(eq(automationRuleRuns.status, status as 'success' | 'failed' | 'skipped'));
    }

    const rows = await db
      .select()
      .from(automationRuleRuns)
      .where(and(...conditions))
      .orderBy(desc(automationRuleRuns.createdAt))
      .limit(limit);

    return NextResponse.json({
      runs: rows.map((run) => ({
        ...run,
        inputJson: run.inputJson ? JSON.parse(run.inputJson) : null,
        outputJson: run.outputJson ? JSON.parse(run.outputJson) : null,
      })),
    });
  } catch (error) {
    console.error('Failed to list automation rule runs:', error);
    return NextResponse.json({ error: 'Failed to list automation rule runs.' }, { status: 500 });
  }
}
