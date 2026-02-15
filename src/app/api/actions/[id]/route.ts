import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scheduledActions } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const actionId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(actionId) || actionId <= 0) {
    return NextResponse.json({ error: 'Invalid action id.' }, { status: 400 });
  }

  const rows = await db.select().from(scheduledActions).where(eq(scheduledActions.id, actionId)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ action: rows[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const actionId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(actionId) || actionId <= 0) {
    return NextResponse.json({ error: 'Invalid action id.' }, { status: 400 });
  }

  const updated = await db
    .update(scheduledActions)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(eq(scheduledActions.id, actionId))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Action not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, action: updated[0] });
}
