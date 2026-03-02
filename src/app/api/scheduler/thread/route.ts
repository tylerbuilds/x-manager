import { NextResponse } from 'next/server';

import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { scheduleThread, type ThreadTweetInput } from '@/lib/thread-scheduler';
import { withIdempotency } from '@/lib/idempotency';
import { suggestOptimalTime } from '@/lib/optimal-time';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ThreadScheduleRequest = {
  accountSlot?: unknown;
  account_slot?: unknown;
  scheduledTime?: unknown;
  scheduled_time?: unknown;
  communityId?: unknown;
  community_id?: unknown;
  replyToTweetId?: unknown;
  reply_to_tweet_id?: unknown;
  dedupe?: unknown;
  threadId?: unknown;
  thread_id?: unknown;
  sourceUrl?: unknown;
  source_url?: unknown;
  autoOptimalTime?: unknown;
  auto_optimal_time?: unknown;
  tweets?: unknown;
};

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return true;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBool(value: unknown, defaultValue: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase().trim();
    if (['1', 'true', 'yes', 'y', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(lowered)) return false;
  }
  return defaultValue;
}

export async function POST(req: Request) {
  return withIdempotency('scheduler-thread', req, async () => {
    try {
      const body = (await req.json()) as ThreadScheduleRequest;

    const rawSlot = body.account_slot ?? body.accountSlot;
    let accountSlot: AccountSlot = 1;
    if (isProvided(rawSlot)) {
      const parsed = parseAccountSlot(rawSlot);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const autoOptimalTime = asBool(body.auto_optimal_time ?? body.autoOptimalTime, false);
    let scheduledAt: Date;
    if (autoOptimalTime) {
      scheduledAt = suggestOptimalTime(accountSlot);
    } else {
      const scheduledTimeRaw = asString(body.scheduled_time ?? body.scheduledTime);
      const parsed = scheduledTimeRaw ? new Date(scheduledTimeRaw) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid scheduled_time. Provide an ISO date string or set auto_optimal_time=true.' }, { status: 400 });
      }
      scheduledAt = parsed;
    }

    const tweetsRaw = body.tweets;
    if (!Array.isArray(tweetsRaw) || tweetsRaw.length === 0) {
      return NextResponse.json({ error: 'Missing tweets. Provide an array of tweet objects.' }, { status: 400 });
    }

    const tweets = tweetsRaw as ThreadTweetInput[];
    const dedupe = asBool(body.dedupe, true);
    const threadId = asString(body.thread_id ?? body.threadId) ?? undefined;
    const communityId = asString(body.community_id ?? body.communityId);
    const replyToTweetId = asString(body.reply_to_tweet_id ?? body.replyToTweetId);
    const sourceUrl = asString(body.source_url ?? body.sourceUrl);

    const result = await scheduleThread({
      accountSlot,
      scheduledTime: scheduledAt,
      tweets,
      threadId,
      dedupe,
      communityId,
      replyToTweetId,
      sourceUrl,
    });

    if (result.skipped) {
      return NextResponse.json({
        skipped: true,
        reason: 'dedupe',
        duplicates: result.duplicates,
      });
    }

    return NextResponse.json({
      threadId: result.threadId,
      scheduled: result.scheduled,
      posts: result.posts,
    });
    } catch (error) {
      console.error('Error scheduling thread:', error);
      return NextResponse.json({ error: 'Failed to schedule thread.' }, { status: 500 });
    }
  });
}
