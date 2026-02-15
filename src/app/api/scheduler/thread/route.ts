import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '@/lib/scheduler-dedupe';
import { ensureSafeUploadUrl } from '@/lib/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ThreadTweetInput = {
  text: string;
  mediaUrls?: string[] | null;
  media_urls?: string[] | null;
  communityId?: string | null;
  community_id?: string | null;
  replyToTweetId?: string | null;
  reply_to_tweet_id?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
};

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

function pickMediaUrls(input: ThreadTweetInput): string[] {
  const raw = input.mediaUrls ?? input.media_urls ?? [];
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string').slice(0, 4);
}

function normalizeMediaUrls(urls: string[]): string[] {
  return urls
    .map((value) => (typeof value === 'string' ? ensureSafeUploadUrl(value) : null))
    .filter((value): value is string => Boolean(value));
}

export async function POST(req: Request) {
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

    const scheduledTimeRaw = asString(body.scheduled_time ?? body.scheduledTime);
    const scheduledAt = scheduledTimeRaw ? new Date(scheduledTimeRaw) : null;

    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_time. Provide an ISO date string.' }, { status: 400 });
    }

    const tweetsRaw = body.tweets;
    if (!Array.isArray(tweetsRaw) || tweetsRaw.length === 0) {
      return NextResponse.json({ error: 'Missing tweets. Provide an array of tweet objects.' }, { status: 400 });
    }

    const tweets = tweetsRaw as ThreadTweetInput[];
    const dedupe = asBool(body.dedupe, true);
    const threadId = asString(body.thread_id ?? body.threadId) ?? crypto.randomUUID();
    const defaultCommunityId = asString(body.community_id ?? body.communityId);
    const threadReplyToTweetId = asString(body.reply_to_tweet_id ?? body.replyToTweetId);
    const threadSourceUrl = asString(body.source_url ?? body.sourceUrl);

    // Pre-compute dedupe keys and check for duplicates before inserting anything.
    const computed = tweets.map((tweet, index) => {
      const text = typeof tweet.text === 'string' ? tweet.text : '';
      const mediaUrls = normalizeMediaUrls(pickMediaUrls(tweet));
      const communityId = asString(tweet.community_id ?? tweet.communityId) ?? defaultCommunityId;
      const replyToTweetId = index === 0
        ? (asString(tweet.reply_to_tweet_id ?? tweet.replyToTweetId) ?? threadReplyToTweetId)
        : null;

      const sourceUrlCandidate =
        (index === 0 ? threadSourceUrl : null) ??
        asString(tweet.source_url ?? tweet.sourceUrl) ??
        extractFirstUrl(text);

      const canonicalUrl = sourceUrlCandidate ? canonicalizeUrl(sourceUrlCandidate) : null;
      const normalizedCopy = normalizeCopy(text);
      const dedupeKey = dedupe && canonicalUrl
        ? computeDedupeKey({ accountSlot, canonicalUrl, normalizedCopy })
        : null;

      return {
        index,
        text,
        mediaUrls,
        communityId,
        replyToTweetId,
        sourceUrl: canonicalUrl,
        dedupeKey,
      };
    });

    const invalidText = computed.find((tweet) => !tweet.text.trim());
    if (invalidText) {
      return NextResponse.json({ error: 'All tweets must have non-empty text.' }, { status: 400 });
    }

    const keysToCheck = computed.map((tweet) => tweet.dedupeKey).filter((key): key is string => Boolean(key));
    if (dedupe && keysToCheck.length > 0) {
      const existing = await db
        .select()
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.accountSlot, accountSlot),
            eq(scheduledPosts.status, 'scheduled'),
            inArray(scheduledPosts.dedupeKey, keysToCheck),
          ),
        );

      if (existing.length > 0) {
        return NextResponse.json({
          skipped: true,
          reason: 'dedupe',
          duplicates: existing.map((post) => ({
            id: post.id,
            accountSlot: post.accountSlot,
            scheduledTime: post.scheduledTime,
            text: post.text,
            sourceUrl: post.sourceUrl,
          })),
        });
      }
    }

    const values = computed.map((tweet) => ({
      accountSlot,
      text: tweet.text,
      sourceUrl: tweet.sourceUrl,
      dedupeKey: tweet.dedupeKey,
      threadId,
      threadIndex: tweet.index,
      mediaUrls: JSON.stringify(tweet.mediaUrls),
      communityId: tweet.communityId,
      replyToTweetId: tweet.replyToTweetId,
      scheduledTime: scheduledAt,
      status: 'scheduled' as const,
    }));

    try {
      const inserted = await db.insert(scheduledPosts).values(values).returning();
      return NextResponse.json({
        threadId,
        scheduled: inserted.length,
        posts: inserted,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (dedupe && message.includes('SQLITE_CONSTRAINT') && keysToCheck.length > 0) {
        const existing = await db
          .select()
          .from(scheduledPosts)
          .where(
            and(
              eq(scheduledPosts.accountSlot, accountSlot),
              eq(scheduledPosts.status, 'scheduled'),
              inArray(scheduledPosts.dedupeKey, keysToCheck),
            ),
          );
        if (existing.length > 0) {
          return NextResponse.json({
            skipped: true,
            reason: 'dedupe',
            duplicates: existing.map((post) => ({
              id: post.id,
              accountSlot: post.accountSlot,
              scheduledTime: post.scheduledTime,
              text: post.text,
              sourceUrl: post.sourceUrl,
            })),
          });
        }
      }
      throw error;
    }
  } catch (error) {
    console.error('Error scheduling thread:', error);
    return NextResponse.json({ error: 'Failed to schedule thread.' }, { status: 500 });
  }
}
