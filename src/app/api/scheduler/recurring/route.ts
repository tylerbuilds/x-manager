import { NextResponse } from 'next/server';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';

import { db } from '@/lib/db';
import { recurringSchedules, contentPool } from '@/lib/db/schema';
import { isAccountSlot, parseAccountSlot } from '@/lib/account-slots';
import { computeNextRunAt, type Frequency } from '@/lib/recurring-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_FREQUENCIES: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'custom_cron'];

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    const statusFilter = url.searchParams.get('status');

    const conditions: SQL[] = [];

    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      conditions.push(eq(recurringSchedules.accountSlot, parsed));
    }

    if (statusFilter) {
      const valid = ['active', 'paused', 'exhausted'] as const;
      type RecStatus = (typeof valid)[number];
      if (valid.includes(statusFilter as RecStatus)) {
        conditions.push(eq(recurringSchedules.status, statusFilter as RecStatus));
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(200, Number(limitParam) || 50));
    const offsetParam = url.searchParams.get('offset');
    const offset = Math.max(0, Number(offsetParam) || 0);

    const [items, [{ total }]] = await Promise.all([
      db.select().from(recurringSchedules).where(where).orderBy(desc(recurringSchedules.createdAt)).limit(limit).offset(offset),
      db.select({ total: count() }).from(recurringSchedules).where(where),
    ]);

    return NextResponse.json({
      items,
      total,
      offset,
      limit,
      hasMore: offset + items.length < total,
    });
  } catch (error) {
    console.error('Error listing recurring schedules:', error);
    return NextResponse.json({ error: 'Failed to list recurring schedules.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 });
    }

    const frequency = body.frequency as string;
    if (!VALID_FREQUENCIES.includes(frequency as Frequency)) {
      return NextResponse.json({ error: `Invalid frequency. Use: ${VALID_FREQUENCIES.join(', ')}` }, { status: 400 });
    }

    if (frequency === 'custom_cron' && !body.cron_expression) {
      return NextResponse.json({ error: 'cron_expression required for custom_cron frequency.' }, { status: 400 });
    }

    const rawSlot = body.account_slot ?? body.accountSlot;
    let accountSlot = 1;
    if (rawSlot !== undefined && rawSlot !== null) {
      const parsed = parseAccountSlot(rawSlot);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const text = typeof body.text === 'string' ? body.text.trim() || null : null;
    const mediaLibraryIds = Array.isArray(body.media_library_ids) ? JSON.stringify(body.media_library_ids) : null;
    const communityId = typeof body.community_id === 'string' ? body.community_id.trim() || null : null;
    const cronExpression = typeof body.cron_expression === 'string' ? body.cron_expression.trim() || null : null;
    const maxRuns = typeof body.max_runs === 'number' && body.max_runs > 0 ? body.max_runs : null;

    const nextRunAt = computeNextRunAt(frequency as Frequency, cronExpression);

    const [inserted] = await db.insert(recurringSchedules).values({
      accountSlot,
      name,
      text,
      mediaLibraryIds: mediaLibraryIds,
      communityId: communityId,
      frequency: frequency as Frequency,
      cronExpression: cronExpression,
      nextRunAt,
      maxRuns,
    }).returning();

    // If content_pool items provided, insert them
    if (Array.isArray(body.content_pool) && body.content_pool.length > 0) {
      for (const poolItem of body.content_pool) {
        if (typeof poolItem.text !== 'string' || !poolItem.text.trim()) continue;
        await db.insert(contentPool).values({
          recurringScheduleId: inserted.id,
          text: poolItem.text.trim(),
          mediaLibraryIds: Array.isArray(poolItem.media_library_ids) ? JSON.stringify(poolItem.media_library_ids) : null,
        });
      }
    }

    return NextResponse.json(inserted);
  } catch (error) {
    console.error('Error creating recurring schedule:', error);
    return NextResponse.json({ error: 'Failed to create recurring schedule.' }, { status: 500 });
  }
}
