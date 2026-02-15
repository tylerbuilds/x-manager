import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { recordEngagementAction } from '@/lib/engagement-ops';

const ALLOWED_STATUSES = ['new', 'reviewed', 'replied', 'dismissed'] as const;
type InboxStatus = (typeof ALLOWED_STATUSES)[number];

type StatusBody = {
  status?: unknown;
  note?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asInboxStatus(value: unknown): InboxStatus | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_STATUSES.includes(parsed as InboxStatus)) return null;
  return parsed as InboxStatus;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const inboxId = Number.parseInt(params.id, 10);
    if (!Number.isFinite(inboxId) || inboxId <= 0) {
      return NextResponse.json({ error: 'Invalid inbox id.' }, { status: 400 });
    }

    const body = (await req.json()) as StatusBody;
    const status = asInboxStatus(body.status);
    if (!status) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    const rows = await db.select().from(engagementInbox).where(eq(engagementInbox.id, inboxId)).limit(1);
    const row = rows[0];
    if (!row) {
      return NextResponse.json({ error: 'Inbox item not found.' }, { status: 404 });
    }

    const updated = await db
      .update(engagementInbox)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(engagementInbox.id, inboxId))
      .returning();

    if (status === 'dismissed') {
      await recordEngagementAction({
        inboxId,
        accountSlot: row.accountSlot as 1 | 2,
        actionType: 'dismiss',
        targetId: row.sourceId,
        payload: { note: asString(body.note) || null },
        status: 'success',
      });
    }

    return NextResponse.json({ ok: true, item: updated[0] });
  } catch (error) {
    console.error('Failed to update engagement inbox item:', error);
    return NextResponse.json({ error: 'Failed to update engagement inbox item.' }, { status: 500 });
  }
}
