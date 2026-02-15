import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scheduledActions } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { action_id?: unknown };
    const actionId = Number(body.action_id);
    if (!Number.isFinite(actionId) || actionId <= 0) {
      return NextResponse.json({ error: 'action_id is required.' }, { status: 400 });
    }

    const rows = await db.select().from(scheduledActions).where(eq(scheduledActions.id, actionId)).limit(1);
    const action = rows[0];
    if (!action) {
      return NextResponse.json({ error: 'Action not found.' }, { status: 404 });
    }

    if (action.status !== 'failed') {
      return NextResponse.json({ error: `Cannot retry action with status "${action.status}". Only failed actions can be retried.` }, { status: 400 });
    }

    const updated = await db
      .update(scheduledActions)
      .set({
        status: 'scheduled',
        error: null,
        resultJson: null,
        scheduledTime: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scheduledActions.id, actionId))
      .returning();

    return NextResponse.json({ ok: true, action: updated[0] });
  } catch (error) {
    console.error('Failed to retry action:', error);
    return NextResponse.json({ error: 'Failed to retry action.' }, { status: 500 });
  }
}
