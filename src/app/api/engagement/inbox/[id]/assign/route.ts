import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// PUT - assign inbox item to a user
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const inboxId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(inboxId) || inboxId <= 0) {
    return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
  }

  const body = (await req.json()) as { assigned_to?: unknown };
  const assignedTo = typeof body.assigned_to === 'string' ? body.assigned_to.trim() || null : null;

  const updated = await db.update(engagementInbox).set({ assignedTo: assignedTo, updatedAt: new Date() }).where(eq(engagementInbox.id, inboxId)).returning();
  if (updated.length === 0) {
    return NextResponse.json({ error: 'Inbox item not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, item: updated[0] });
}
