import { and, desc, eq, lte } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scheduledActions } from '@/lib/db/schema';
import { withIdempotency } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountSlot = url.searchParams.get('account_slot');
    const status = url.searchParams.get('status');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    let query = db.select().from(scheduledActions);

    const conditions = [];
    if (accountSlot) {
      const slot = Number.parseInt(accountSlot, 10);
      if (slot === 1 || slot === 2) {
        conditions.push(eq(scheduledActions.accountSlot, slot));
      }
    }
    if (status) {
      conditions.push(eq(scheduledActions.status, status as 'scheduled' | 'completed' | 'failed' | 'cancelled'));
    }

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    const rows = await query.orderBy(desc(scheduledActions.scheduledTime)).limit(limit);
    return NextResponse.json({ actions: rows });
  } catch (error) {
    console.error('Failed to list scheduled actions:', error);
    return NextResponse.json({ error: 'Failed to list actions.' }, { status: 500 });
  }
}

type ScheduleActionBody = {
  account_slot?: unknown;
  action_type?: unknown;
  target_id?: unknown;
  payload?: unknown;
  scheduled_time?: unknown;
  idempotency_key?: unknown;
};

export async function POST(req: Request) {
  return withIdempotency('schedule-action', req, async () => {
    try {
      const body = (await req.json()) as ScheduleActionBody;

      const accountSlot = Number(body.account_slot || 1);
      if (accountSlot !== 1 && accountSlot !== 2) {
        return NextResponse.json({ error: 'account_slot must be 1 or 2.' }, { status: 400 });
      }

      const actionType = String(body.action_type || '');
      if (!['reply', 'dm', 'like', 'repost'].includes(actionType)) {
        return NextResponse.json({ error: 'action_type must be reply, dm, like, or repost.' }, { status: 400 });
      }

      const targetId = typeof body.target_id === 'string' ? body.target_id : null;
      const payloadJson = JSON.stringify(body.payload ?? {});

      const scheduledTime = typeof body.scheduled_time === 'string' ? new Date(body.scheduled_time) : null;
      if (!scheduledTime || Number.isNaN(scheduledTime.getTime())) {
        return NextResponse.json({ error: 'scheduled_time is required (ISO date).' }, { status: 400 });
      }

      const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;

      const result = await db.insert(scheduledActions).values({
        accountSlot,
        actionType: actionType as 'reply' | 'dm' | 'like' | 'repost',
        targetId,
        payloadJson,
        scheduledTime,
        status: 'scheduled',
        idempotencyKey,
      }).returning();

      return NextResponse.json({ ok: true, action: result[0] }, { status: 201 });
    } catch (error) {
      console.error('Failed to schedule action:', error);
      return NextResponse.json({ error: 'Failed to schedule action.' }, { status: 500 });
    }
  });
}
