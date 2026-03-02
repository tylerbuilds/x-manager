import { sqlite } from '@/lib/db';

interface HeatmapEntry {
  day_of_week: number;
  hour: number;
  avg_engagement: number;
  post_count: number;
}

/**
 * Suggest the next optimal posting time based on historical engagement data.
 * Returns a Date in the future (within the next 72 hours) at the hour with
 * the highest average engagement that doesn't already have a post scheduled.
 *
 * Falls back to a sensible default (next day at 10:00 UTC) if no data.
 */
export function suggestOptimalTime(accountSlot: number, days = 90): Date {
  const params: unknown[] = [days];
  const slotFilter = accountSlot != null ? 'AND sp.account_slot = ?' : '';
  if (accountSlot != null) params.push(accountSlot);

  // Get engagement by day-of-week + hour
  const rows = sqlite
    .prepare(
      `SELECT
        CAST(strftime('%w', sp.scheduled_time, 'unixepoch') AS INTEGER) as day_of_week,
        CAST(strftime('%H', sp.scheduled_time, 'unixepoch') AS INTEGER) as hour,
        COUNT(DISTINCT sp.id) as post_count,
        COALESCE(AVG(pm.likes + pm.retweets + pm.replies + pm.quotes), 0) as avg_engagement
      FROM scheduled_posts sp
      LEFT JOIN (
        SELECT pm1.*
        FROM post_metrics pm1
        INNER JOIN (
          SELECT twitter_post_id, MAX(fetched_at) as max_fetched
          FROM post_metrics
          GROUP BY twitter_post_id
        ) pm2 ON pm1.twitter_post_id = pm2.twitter_post_id AND pm1.fetched_at = pm2.max_fetched
      ) pm ON sp.twitter_post_id = pm.twitter_post_id
      WHERE sp.status = 'posted'
        AND sp.scheduled_time >= unixepoch() - (? * 86400)
        ${slotFilter}
      GROUP BY day_of_week, hour
      HAVING post_count >= 1
      ORDER BY avg_engagement DESC`,
    )
    .all(...params) as HeatmapEntry[];

  // Build ranked slots (sorted best engagement first)
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);

  // Get already-scheduled times in the next 72 hours to avoid collisions
  const scheduledSlots = new Set<string>();
  const existingRows = sqlite
    .prepare(
      `SELECT scheduled_time FROM scheduled_posts
       WHERE status = 'scheduled'
         AND account_slot = ?
         AND scheduled_time > ?
         AND scheduled_time < ?`,
    )
    .all(accountSlot, nowEpoch, nowEpoch + 72 * 3600) as Array<{ scheduled_time: number }>;

  for (const row of existingRows) {
    const d = new Date(row.scheduled_time * 1000);
    scheduledSlots.add(`${d.getUTCDay()}-${d.getUTCHours()}`);
  }

  // Try each ranked slot, find the next occurrence in the future
  for (const slot of rows) {
    const candidate = nextOccurrence(now, slot.day_of_week, slot.hour);
    if (!candidate) continue;

    const key = `${candidate.getUTCDay()}-${candidate.getUTCHours()}`;
    if (scheduledSlots.has(key)) continue;

    return candidate;
  }

  // Fallback: tomorrow at 10:00 UTC
  const fallback = new Date(now);
  fallback.setUTCDate(fallback.getUTCDate() + 1);
  fallback.setUTCHours(10, 0, 0, 0);
  return fallback;
}

/**
 * Find the next occurrence of a specific day-of-week + hour that's at least
 * 30 minutes in the future and within 7 days.
 */
function nextOccurrence(now: Date, dayOfWeek: number, hour: number): Date | null {
  const minFuture = new Date(now.getTime() + 30 * 60 * 1000); // at least 30min from now

  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    candidate.setUTCHours(hour, 0, 0, 0);

    if (candidate.getUTCDay() === dayOfWeek && candidate > minFuture) {
      return candidate;
    }
  }

  return null;
}

/**
 * Return ranked time suggestions for an agent to choose from.
 */
export function suggestMultipleOptimalTimes(
  accountSlot: number,
  count = 5,
  days = 90,
): Array<{ time: Date; dayOfWeek: number; hour: number; avgEngagement: number }> {
  const params: unknown[] = [days];
  const slotFilter = accountSlot != null ? 'AND sp.account_slot = ?' : '';
  if (accountSlot != null) params.push(accountSlot);

  const rows = sqlite
    .prepare(
      `SELECT
        CAST(strftime('%w', sp.scheduled_time, 'unixepoch') AS INTEGER) as day_of_week,
        CAST(strftime('%H', sp.scheduled_time, 'unixepoch') AS INTEGER) as hour,
        COUNT(DISTINCT sp.id) as post_count,
        COALESCE(AVG(pm.likes + pm.retweets + pm.replies + pm.quotes), 0) as avg_engagement
      FROM scheduled_posts sp
      LEFT JOIN (
        SELECT pm1.*
        FROM post_metrics pm1
        INNER JOIN (
          SELECT twitter_post_id, MAX(fetched_at) as max_fetched
          FROM post_metrics
          GROUP BY twitter_post_id
        ) pm2 ON pm1.twitter_post_id = pm2.twitter_post_id AND pm1.fetched_at = pm2.max_fetched
      ) pm ON sp.twitter_post_id = pm.twitter_post_id
      WHERE sp.status = 'posted'
        AND sp.scheduled_time >= unixepoch() - (? * 86400)
        ${slotFilter}
      GROUP BY day_of_week, hour
      HAVING post_count >= 1
      ORDER BY avg_engagement DESC
      LIMIT ?`,
    )
    .all(...params, count * 3) as HeatmapEntry[];

  const now = new Date();
  const suggestions: Array<{ time: Date; dayOfWeek: number; hour: number; avgEngagement: number }> = [];

  for (const slot of rows) {
    if (suggestions.length >= count) break;
    const candidate = nextOccurrence(now, slot.day_of_week, slot.hour);
    if (candidate) {
      suggestions.push({
        time: candidate,
        dayOfWeek: slot.day_of_week,
        hour: slot.hour,
        avgEngagement: Math.round(slot.avg_engagement * 100) / 100,
      });
    }
  }

  return suggestions;
}
