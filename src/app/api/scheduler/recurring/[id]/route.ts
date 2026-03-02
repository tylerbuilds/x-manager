import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db, sqlite } from '@/lib/db';
import { recurringSchedules, contentPool } from '@/lib/db/schema';
import { computeNextRunAt, type Frequency } from '@/lib/recurring-processor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_FREQUENCIES: Frequency[] = ['daily', 'weekly', 'biweekly', 'monthly', 'custom_cron'];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isFinite(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID.' }, { status: 400 });
    }

    const [schedule] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, scheduleId)).limit(1);
    if (!schedule) {
      return NextResponse.json({ error: 'Recurring schedule not found.' }, { status: 404 });
    }

    const pool = await db.select().from(contentPool).where(eq(contentPool.recurringScheduleId, scheduleId));

    return NextResponse.json({ ...schedule, contentPool: pool });
  } catch (error) {
    console.error('Error fetching recurring schedule:', error);
    return NextResponse.json({ error: 'Failed to fetch recurring schedule.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isFinite(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID.' }, { status: 400 });
    }

    const [existing] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, scheduleId)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'Recurring schedule not found.' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.name === 'string' && body.name.trim()) {
      updates.name = body.name.trim();
    }

    if (body.text !== undefined) {
      updates.text = typeof body.text === 'string' ? body.text.trim() || null : null;
    }

    if (body.media_library_ids !== undefined) {
      updates.mediaLibraryIds = Array.isArray(body.media_library_ids) ? JSON.stringify(body.media_library_ids) : null;
    }

    if (body.community_id !== undefined) {
      updates.communityId = typeof body.community_id === 'string' ? body.community_id.trim() || null : null;
    }

    if (body.frequency && VALID_FREQUENCIES.includes(body.frequency as Frequency)) {
      updates.frequency = body.frequency;
      const cron = body.cron_expression ?? existing.cronExpression;
      updates.nextRunAt = computeNextRunAt(body.frequency as Frequency, cron);
    }

    if (body.cron_expression !== undefined) {
      updates.cronExpression = typeof body.cron_expression === 'string' ? body.cron_expression.trim() || null : null;
    }

    if (body.max_runs !== undefined) {
      updates.maxRuns = typeof body.max_runs === 'number' && body.max_runs > 0 ? body.max_runs : null;
    }

    if (body.status !== undefined) {
      const valid = ['active', 'paused', 'exhausted'] as const;
      type RecStatus = (typeof valid)[number];
      if (valid.includes(body.status as RecStatus)) {
        updates.status = body.status;
        // When resuming, recalculate next_run_at
        if (body.status === 'active' && existing.status === 'paused') {
          const freq = (updates.frequency ?? existing.frequency) as Frequency;
          const cron = (updates.cronExpression ?? existing.cronExpression) as string | null;
          updates.nextRunAt = computeNextRunAt(freq, cron);
        }
      }
    }

    const [updated] = await db.update(recurringSchedules).set(updates).where(eq(recurringSchedules.id, scheduleId)).returning();
    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating recurring schedule:', error);
    return NextResponse.json({ error: 'Failed to update recurring schedule.' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isFinite(scheduleId)) {
      return NextResponse.json({ error: 'Invalid schedule ID.' }, { status: 400 });
    }

    const [existing] = await db.select().from(recurringSchedules).where(eq(recurringSchedules.id, scheduleId)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'Recurring schedule not found.' }, { status: 404 });
    }

    // Delete schedule + pool atomically
    sqlite.exec('BEGIN');
    try {
      await db.delete(contentPool).where(eq(contentPool.recurringScheduleId, scheduleId));
      await db.delete(recurringSchedules).where(eq(recurringSchedules.id, scheduleId));
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }

    return NextResponse.json({ ok: true, deleted: scheduleId });
  } catch (error) {
    console.error('Error deleting recurring schedule:', error);
    return NextResponse.json({ error: 'Failed to delete recurring schedule.' }, { status: 500 });
  }
}
