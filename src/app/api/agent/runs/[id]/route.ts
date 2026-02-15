import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentRuns, agentRunSteps } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const runId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(runId) || runId <= 0) {
    return NextResponse.json({ error: 'Invalid run id.' }, { status: 400 });
  }

  try {
    const runRows = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
    const run = runRows[0];
    if (!run) {
      return NextResponse.json({ error: 'Run not found.' }, { status: 404 });
    }

    const steps = await db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId));

    return NextResponse.json({ run, steps });
  } catch (error) {
    console.error('Failed to get agent run:', error);
    return NextResponse.json({ error: 'Failed to get run.' }, { status: 500 });
  }
}
