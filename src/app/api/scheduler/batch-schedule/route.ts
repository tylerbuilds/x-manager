import { and, eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '@/lib/scheduler-dedupe';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DAYS = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return true;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const tweets = Array.isArray(body?.tweets) ? body.tweets : null;
    if (!tweets || tweets.length === 0) {
      return NextResponse.json({ error: 'No tweets provided.' }, { status: 400 });
    }

    const rawSlot = body?.account_slot ?? body?.accountSlot;
    let accountSlot: AccountSlot = 1;
    if (isProvided(rawSlot)) {
      const parsed = parseAccountSlot(rawSlot);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const days = clamp(asInt(body?.days) ?? DEFAULT_DAYS, 1, 30);
    const windowStartHour = clamp(asInt(body?.window_start_hour ?? body?.start_hour) ?? 7, 0, 23);
    const windowEndHour = clamp(asInt(body?.window_end_hour ?? body?.end_hour) ?? 23, 1, 24);

    if (windowEndHour <= windowStartHour) {
      return NextResponse.json({ error: 'Invalid window hours. end_hour must be greater than start_hour.' }, { status: 400 });
    }

    const startTimeRaw = asString(body?.start_time ?? body?.startTime);
    const base = startTimeRaw ? new Date(startTimeRaw) : new Date();
    if (startTimeRaw && Number.isNaN(base.getTime())) {
      return NextResponse.json({ error: 'Invalid start_time. Provide an ISO date string.' }, { status: 400 });
    }

    const dedupe = body?.dedupe !== undefined ? Boolean(body.dedupe) : true;

    const scheduledPostsData: Array<{
      accountSlot: AccountSlot;
      text: string;
      sourceUrl: string | null;
      dedupeKey: string | null;
      scheduledTime: Date;
      status: 'scheduled';
    }> = [];

    // Distribute evenly across the requested number of days.
    const totalTweets = tweets.length;
    const baseTweetsPerDay = Math.floor(totalTweets / days);
    const extraTweets = totalTweets % days;

    const tweetsPerDay = Array(days).fill(baseTweetsPerDay);
    for (let i = 0; i < extraTweets; i += 1) {
      tweetsPerDay[i] += 1;
    }

    let tweetIndex = 0;

    for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
      const tweetsForThisDay = tweetsPerDay[dayOffset];
      if (tweetsForThisDay <= 0) continue;

      const scheduledDate = new Date(base);
      scheduledDate.setDate(base.getDate() + dayOffset);
      scheduledDate.setSeconds(0, 0);

      const totalMinutes = (windowEndHour - windowStartHour) * 60;
      const intervalMinutes = tweetsForThisDay > 1 ? totalMinutes / (tweetsForThisDay - 1) : 0;

      for (let postInDay = 0; postInDay < tweetsForThisDay && tweetIndex < totalTweets; postInDay += 1) {
        const currentDate = new Date(scheduledDate);
        const minutesFromStart = postInDay * intervalMinutes;
        const hour = windowStartHour + Math.floor(minutesFromStart / 60);
        const minute = Math.floor(minutesFromStart % 60);

        currentDate.setHours(hour, minute, 0, 0);

        const text = String(tweets[tweetIndex] ?? '');
        const extractedUrl = extractFirstUrl(text);
        const canonicalUrl = extractedUrl ? canonicalizeUrl(extractedUrl) : null;
        const dedupeKey = dedupe && canonicalUrl
          ? computeDedupeKey({
              accountSlot,
              canonicalUrl,
              normalizedCopy: normalizeCopy(text),
            })
          : null;

        scheduledPostsData.push({
          accountSlot,
          text,
          sourceUrl: canonicalUrl,
          dedupeKey,
          scheduledTime: currentDate,
          status: 'scheduled',
        });

        tweetIndex += 1;
      }
    }

    let skipped = 0;

    if (scheduledPostsData.length > 0) {
      const keys = scheduledPostsData
        .map((post) => post.dedupeKey)
        .filter((key): key is string => typeof key === 'string' && key.length > 0);

      const existingKeys = new Set<string>();
      if (keys.length > 0) {
        const existing = await db
          .select({ dedupeKey: scheduledPosts.dedupeKey })
          .from(scheduledPosts)
          .where(
            and(
              eq(scheduledPosts.accountSlot, accountSlot),
              eq(scheduledPosts.status, 'scheduled'),
              inArray(scheduledPosts.dedupeKey, keys),
            ),
          );
        for (const row of existing) {
          if (row.dedupeKey) existingKeys.add(row.dedupeKey);
        }
      }

      const seenKeys = new Set<string>();
      const filtered = scheduledPostsData.filter((post) => {
        if (!post.dedupeKey) return true;
        if (existingKeys.has(post.dedupeKey)) return false;
        if (seenKeys.has(post.dedupeKey)) return false;
        seenKeys.add(post.dedupeKey);
        return true;
      });

      skipped = scheduledPostsData.length - filtered.length;
      if (filtered.length > 0) {
        await db.insert(scheduledPosts).values(filtered);
      }
    }

    return NextResponse.json({
      ok: true,
      message: 'Tweets scheduled successfully',
      accountSlot,
      days,
      window: {
        startHour: windowStartHour,
        endHour: windowEndHour,
      },
      scheduled: scheduledPostsData.length - skipped,
      skipped,
    });
  } catch (error) {
    console.error('Error batch scheduling tweets:', error);
    return NextResponse.json({ error: 'Failed to schedule tweets.' }, { status: 500 });
  }
}
