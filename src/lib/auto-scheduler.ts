import { and, asc, eq } from 'drizzle-orm';
import { db, sqlite } from './db';
import { contentQueue, scheduledPosts } from './db/schema';

// Default optimal posting times (if no analytics data available)
const DEFAULT_POSTING_HOURS = [9, 12, 15, 18, 20];

function getBestTimesFromAnalytics(): Array<{ dayOfWeek: number; hour: number }> {
  try {
    const rows = sqlite.prepare(`
      SELECT
        CAST(strftime('%w', sp.scheduled_time, 'unixepoch') AS INTEGER) as day_of_week,
        CAST(strftime('%H', sp.scheduled_time, 'unixepoch') AS INTEGER) as hour,
        AVG(pm.likes + pm.retweets + pm.replies + pm.quotes) as avg_engagement
      FROM scheduled_posts sp
      INNER JOIN (
        SELECT pm1.*
        FROM post_metrics pm1
        INNER JOIN (
          SELECT twitter_post_id, MAX(fetched_at) as max_fetched
          FROM post_metrics GROUP BY twitter_post_id
        ) pm2 ON pm1.twitter_post_id = pm2.twitter_post_id AND pm1.fetched_at = pm2.max_fetched
      ) pm ON sp.twitter_post_id = pm.twitter_post_id
      WHERE sp.status = 'posted'
        AND sp.scheduled_time >= unixepoch() - (90 * 86400)
      GROUP BY day_of_week, hour
      HAVING COUNT(*) >= 2
      ORDER BY avg_engagement DESC
      LIMIT 10
    `).all() as Array<{ day_of_week: number; hour: number; avg_engagement: number }>;

    if (rows.length >= 3) {
      return rows.map((r) => ({ dayOfWeek: r.day_of_week, hour: r.hour }));
    }
  } catch {
    // Fall through to defaults
  }
  return [];
}

function getNextAvailableSlots(
  accountSlot: number,
  count: number,
  startFrom: Date = new Date(),
): Date[] {
  const bestTimes = getBestTimesFromAnalytics();
  const slots: Date[] = [];
  const cursor = new Date(startFrom);
  cursor.setMinutes(0, 0, 0);

  // Get already-scheduled times to avoid conflicts
  const existingTimes = new Set<string>();
  try {
    const existing = sqlite.prepare(`
      SELECT scheduled_time FROM scheduled_posts
      WHERE account_slot = ? AND status = 'scheduled'
    `).all(accountSlot) as Array<{ scheduled_time: number }>;
    for (const row of existing) {
      const d = new Date(row.scheduled_time * 1000);
      existingTimes.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`);
    }
  } catch {
    // Continue without conflict check
  }

  const maxIterations = count * 48; // safety limit
  let iterations = 0;

  while (slots.length < count && iterations < maxIterations) {
    iterations++;
    cursor.setHours(cursor.getHours() + 1);

    const dayOfWeek = cursor.getDay();
    const hour = cursor.getHours();
    const timeKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}-${hour}`;

    if (existingTimes.has(timeKey)) continue;

    let isGoodTime = false;

    if (bestTimes.length > 0) {
      isGoodTime = bestTimes.some((bt) => bt.dayOfWeek === dayOfWeek && bt.hour === hour);
    } else {
      isGoodTime = DEFAULT_POSTING_HOURS.includes(hour);
    }

    if (isGoodTime) {
      slots.push(new Date(cursor));
      existingTimes.add(timeKey);
    }
  }

  return slots;
}

export async function processQueue(accountSlot: number): Promise<{ scheduled: number }> {
  // Get queued items ordered by position
  const queuedItems = await db
    .select()
    .from(contentQueue)
    .where(
      and(
        eq(contentQueue.accountSlot, accountSlot),
        eq(contentQueue.status, 'queued'),
      ),
    )
    .orderBy(asc(contentQueue.position));

  if (queuedItems.length === 0) {
    return { scheduled: 0 };
  }

  const timeSlots = getNextAvailableSlots(accountSlot, queuedItems.length);
  let scheduled = 0;

  for (let i = 0; i < queuedItems.length && i < timeSlots.length; i++) {
    const item = queuedItems[i];
    const slot = timeSlots[i];

    // Create scheduled post
    const inserted = await db.insert(scheduledPosts).values({
      accountSlot: item.accountSlot,
      text: item.text,
      mediaUrls: item.mediaUrls,
      communityId: item.communityId,
      scheduledTime: slot,
    }).returning();

    if (inserted.length > 0) {
      // Update queue item
      await db.update(contentQueue).set({
        status: 'scheduled',
        scheduledPostId: inserted[0].id,
        updatedAt: new Date(),
      }).where(eq(contentQueue.id, item.id));
      scheduled++;
    }
  }

  return { scheduled };
}
