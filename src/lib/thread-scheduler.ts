import crypto from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '@/lib/scheduler-dedupe';
import { ensureSafeUploadUrl } from '@/lib/uploads';

export interface ThreadTweetInput {
  text: string;
  mediaUrls?: string[] | null;
  media_urls?: string[] | null;
  communityId?: string | null;
  community_id?: string | null;
  replyToTweetId?: string | null;
  reply_to_tweet_id?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
}

export interface ScheduleThreadOptions {
  accountSlot?: AccountSlot;
  scheduledTime: Date;
  tweets: ThreadTweetInput[];
  threadId?: string;
  dedupe?: boolean;
  communityId?: string | null;
  replyToTweetId?: string | null;
  sourceUrl?: string | null;
}

export interface ScheduleThreadResult {
  threadId: string;
  scheduled: number;
  posts: Array<Record<string, unknown>>;
  skipped?: boolean;
  duplicates?: Array<Record<string, unknown>>;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickMediaUrls(input: ThreadTweetInput): string[] {
  const raw = input.mediaUrls ?? input.media_urls ?? [];
  if (!raw || !Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string').slice(0, 4);
}

function normalizeMediaUrls(urls: string[]): string[] {
  return urls
    .map((value) => (typeof value === 'string' ? ensureSafeUploadUrl(value) : null))
    .filter((value): value is string => Boolean(value));
}

/**
 * Schedule a thread of tweets directly via DB insert.
 * Extracted from /api/scheduler/thread to avoid self-referential HTTP calls.
 */
export async function scheduleThread(options: ScheduleThreadOptions): Promise<ScheduleThreadResult> {
  const {
    accountSlot = 1,
    scheduledTime,
    tweets,
    threadId: threadIdInput,
    dedupe = true,
    communityId: defaultCommunityId = null,
    replyToTweetId: threadReplyToTweetId = null,
    sourceUrl: threadSourceUrl = null,
  } = options;

  if (!tweets.length) throw new Error('No tweets provided.');

  const threadId = threadIdInput || crypto.randomUUID();

  // Pre-compute dedupe keys
  const computed = tweets.map((tweet, index) => {
    const text = typeof tweet.text === 'string' ? tweet.text : '';
    const mediaUrls = normalizeMediaUrls(pickMediaUrls(tweet));
    const communityId = asString(tweet.community_id ?? tweet.communityId) ?? defaultCommunityId;
    const replyToTweetId = index === 0
      ? (asString(tweet.reply_to_tweet_id ?? tweet.replyToTweetId) ?? threadReplyToTweetId)
      : null;

    const sourceUrlCandidate =
      threadSourceUrl ??
      asString(tweet.source_url ?? tweet.sourceUrl) ??
      extractFirstUrl(text);

    const canonicalUrl = sourceUrlCandidate ? canonicalizeUrl(sourceUrlCandidate) : null;
    const normalizedCopy = normalizeCopy(text);
    const dedupeKey = dedupe && canonicalUrl
      ? computeDedupeKey({ accountSlot, canonicalUrl, normalizedCopy })
      : null;

    return { index, text, mediaUrls, communityId, replyToTweetId, sourceUrl: canonicalUrl, dedupeKey };
  });

  const invalidText = computed.find((t) => !t.text.trim());
  if (invalidText) throw new Error('All tweets must have non-empty text.');

  // Dedupe check
  const keysToCheck = computed.map((t) => t.dedupeKey).filter((k): k is string => Boolean(k));
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
      return {
        threadId,
        scheduled: 0,
        posts: [],
        skipped: true,
        duplicates: existing.map((post) => ({
          id: post.id,
          accountSlot: post.accountSlot,
          scheduledTime: post.scheduledTime,
          text: post.text,
          sourceUrl: post.sourceUrl,
        })),
      };
    }

    // Clean up old failed/cancelled posts with matching dedupe keys to prevent duplicate rows
    const stale = await db
      .select({ id: scheduledPosts.id })
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.accountSlot, accountSlot),
          inArray(scheduledPosts.status, ['failed', 'cancelled']),
          inArray(scheduledPosts.dedupeKey, keysToCheck),
        ),
      );

    if (stale.length > 0) {
      await db
        .delete(scheduledPosts)
        .where(inArray(scheduledPosts.id, stale.map((row) => row.id)));
    }
  }

  // Build insert values
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
    scheduledTime,
    status: 'scheduled' as const,
  }));

  try {
    const inserted = await db.insert(scheduledPosts).values(values).returning();
    return { threadId, scheduled: inserted.length, posts: inserted };
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
        return {
          threadId,
          scheduled: 0,
          posts: [],
          skipped: true,
          duplicates: existing.map((post) => ({
            id: post.id,
            accountSlot: post.accountSlot,
            scheduledTime: post.scheduledTime,
            text: post.text,
            sourceUrl: post.sourceUrl,
          })),
        };
      }
    }
    throw error;
  }
}
