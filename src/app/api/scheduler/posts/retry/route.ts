import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { isAccountSlot } from '@/lib/account-slots';

export const dynamic = 'force-dynamic';

type RetryRequest = {
  id?: unknown;
  ids?: unknown;
  thread_id?: unknown;
  account_slot?: unknown;
  include_cancelled?: unknown;
  scheduled_time?: unknown;
};

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

export async function POST(req: Request) {
  try {
    let body: RetryRequest = {};
    try {
      body = (await req.json()) as RetryRequest;
    } catch {
      body = {};
    }

    const includeCancelled = asBool(body.include_cancelled, true);
    const targetStatuses = includeCancelled ? ['failed', 'cancelled'] : ['failed'];

    const idFromBody = asInt(body.id);
    const idsFromBody = Array.isArray(body.ids)
      ? body.ids
          .map((value) => asInt(value))
          .filter((value): value is number => typeof value === 'number' && value > 0)
      : [];
    const targetIds = [...new Set([...(idFromBody && idFromBody > 0 ? [idFromBody] : []), ...idsFromBody])];

    // Resolve thread_id: find all failed/cancelled posts in that thread
    const threadId = typeof body.thread_id === 'string' ? body.thread_id.trim() : null;
    if (threadId) {
      const threadPosts = await db
        .select({ id: scheduledPosts.id })
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.threadId, threadId),
            inArray(scheduledPosts.status, targetStatuses as Array<'failed' | 'cancelled'>),
          ),
        );
      for (const row of threadPosts) {
        if (!targetIds.includes(row.id)) targetIds.push(row.id);
      }
    }

    // Parse optional scheduled_time for rescheduling
    const scheduledTime = typeof body.scheduled_time === 'string'
      ? new Date(body.scheduled_time)
      : null;
    if (scheduledTime && Number.isNaN(scheduledTime.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_time. Provide a valid ISO 8601 string.' }, { status: 400 });
    }

    const slotRaw = asInt(body.account_slot);
    if (slotRaw !== null && !isAccountSlot(slotRaw)) {
      return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
    }

    const conditions = [];
    conditions.push(inArray(scheduledPosts.status, targetStatuses as Array<'failed' | 'cancelled'>));
    if (slotRaw !== null) {
      conditions.push(eq(scheduledPosts.accountSlot, slotRaw));
    }
    if (targetIds.length > 0) {
      conditions.push(inArray(scheduledPosts.id, targetIds));
    }

    const candidates = await db
      .select({
        id: scheduledPosts.id,
      })
      .from(scheduledPosts)
      .where(and(...conditions));

    const idsToRetry = candidates.map((row) => row.id);
    if (idsToRetry.length === 0) {
      return NextResponse.json({ retried: 0, ids: [] });
    }

    const result = await db
      .update(scheduledPosts)
      .set({
        status: 'scheduled',
        scheduledTime: scheduledTime ?? new Date(),
        twitterPostId: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(inArray(scheduledPosts.id, idsToRetry))
      .returning({ id: scheduledPosts.id });

    return NextResponse.json({
      retried: result.length,
      ids: result.map((row) => row.id),
    });
  } catch (error) {
    console.error('Error retrying scheduled posts:', error);
    return NextResponse.json({ error: 'Failed to retry scheduled posts.' }, { status: 500 });
  }
}
