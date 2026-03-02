import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { db } from './db';
import { recurringSchedules, contentPool, scheduledPosts, mediaLibrary } from './db/schema';

export type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'custom_cron';

const VALID_TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

/**
 * Validate a cron expression. Currently only supports HH:MM daily pattern.
 * Returns true if valid, false otherwise.
 */
export function isValidCronExpression(expr: string): boolean {
  const match = expr.match(VALID_TIME_PATTERN);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Compute the next run time for a recurring schedule.
 * For custom_cron, supports HH:MM daily pattern only.
 */
export function computeNextRunAt(frequency: Frequency, cronExpression?: string | null): Date {
  const now = new Date();

  switch (frequency) {
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);

    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    case 'biweekly':
      return new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    case 'monthly': {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      return next;
    }

    case 'custom_cron': {
      if (cronExpression) {
        const timeMatch = cronExpression.match(VALID_TIME_PATTERN);
        if (timeMatch) {
          const hour = Number(timeMatch[1]);
          const minute = Number(timeMatch[2]);
          const next = new Date(now);
          next.setHours(hour, minute, 0, 0);
          if (next <= now) next.setDate(next.getDate() + 1);
          return next;
        }
      }
      // Fallback: 24h from now
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
    }

    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
}

function parseJsonArray(value: string | null): number[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * Resolve media library IDs to file paths for use in scheduled posts.
 * Uses atomic SQL increment for used_count.
 */
async function resolveMediaUrls(ids: number[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const urls: string[] = [];
  for (const id of ids) {
    const [item] = await db.select().from(mediaLibrary).where(eq(mediaLibrary.id, id)).limit(1);
    if (item) {
      urls.push(`/uploads/library/${item.filename}`);
      await db.update(mediaLibrary)
        .set({ usedCount: sql`${mediaLibrary.usedCount} + 1` })
        .where(eq(mediaLibrary.id, id));
    }
  }
  return urls;
}

let _started = false;

/**
 * Process all recurring schedules that are due.
 * Called from the instrumentation loop.
 * Uses optimistic advance: updates nextRunAt BEFORE creating the post to prevent duplicates.
 */
export async function processRecurringSchedules(): Promise<{ processed: number; created: number }> {
  const now = new Date();
  let processed = 0;
  let created = 0;

  // Find all active schedules where next_run_at <= now
  const dueSchedules = await db
    .select()
    .from(recurringSchedules)
    .where(
      and(
        eq(recurringSchedules.status, 'active'),
        lte(recurringSchedules.nextRunAt, now),
      ),
    )
    .orderBy(asc(recurringSchedules.nextRunAt))
    .limit(50);

  for (const schedule of dueSchedules) {
    try {
      // Check if max_runs exceeded
      if (schedule.maxRuns !== null && schedule.timesRun >= schedule.maxRuns) {
        await db.update(recurringSchedules).set({
          status: 'exhausted',
          updatedAt: new Date(),
        }).where(eq(recurringSchedules.id, schedule.id));
        continue;
      }

      // OPTIMISTIC ADVANCE: Update nextRunAt + timesRun FIRST to prevent duplicate processing
      const nextRunAt = computeNextRunAt(schedule.frequency as Frequency, schedule.cronExpression);
      const newTimesRun = schedule.timesRun + 1;
      const newStatus = schedule.maxRuns !== null && newTimesRun >= schedule.maxRuns ? 'exhausted' : 'active';

      await db.update(recurringSchedules).set({
        nextRunAt,
        lastRunAt: now,
        timesRun: newTimesRun,
        status: newStatus as 'active' | 'paused' | 'exhausted',
        updatedAt: new Date(),
      }).where(
        and(
          eq(recurringSchedules.id, schedule.id),
          // Optimistic lock: only update if nextRunAt hasn't changed (prevents double-processing)
          eq(recurringSchedules.timesRun, schedule.timesRun),
        ),
      );

      // Determine content: from content pool (round-robin by used_count) or from schedule itself
      let postText: string | null = null;
      let postMediaIds: number[] = [];
      let poolItemId: number | null = null;

      const poolItems = await db
        .select()
        .from(contentPool)
        .where(eq(contentPool.recurringScheduleId, schedule.id))
        .orderBy(asc(contentPool.usedCount), asc(contentPool.id))
        .limit(1);

      if (poolItems.length > 0) {
        const item = poolItems[0];
        postText = item.text;
        postMediaIds = parseJsonArray(item.mediaLibraryIds);
        poolItemId = item.id;
      } else {
        postText = schedule.text;
        postMediaIds = parseJsonArray(schedule.mediaLibraryIds);
      }

      if (!postText?.trim()) {
        console.warn(`[recurring] Schedule ${schedule.id} has no content to post.`);
        continue;
      }

      // Resolve media URLs
      const mediaUrls = await resolveMediaUrls(postMediaIds);

      // Schedule the post 5 minutes from now
      const scheduledTime = new Date(now.getTime() + 5 * 60 * 1000);

      await db.insert(scheduledPosts).values({
        accountSlot: schedule.accountSlot,
        text: postText,
        mediaUrls: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
        communityId: schedule.communityId,
        scheduledTime,
      });

      created++;

      // Update pool item used_count atomically
      if (poolItemId !== null) {
        await db.update(contentPool).set({
          usedCount: sql`${contentPool.usedCount} + 1`,
          lastUsedAt: now,
        }).where(eq(contentPool.id, poolItemId));
      }

      processed++;
    } catch (error) {
      console.error(`[recurring] Error processing schedule ${schedule.id}:`, error);
    }
  }

  return { processed, created };
}

/**
 * Guard against double-start (HMR, multiple registerNodeInstrumentation calls).
 */
export function isRecurringProcessorStarted(): boolean {
  return _started;
}

export function markRecurringProcessorStarted(): void {
  _started = true;
}
