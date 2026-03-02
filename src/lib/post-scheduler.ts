import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { scheduledPosts } from './db/schema';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from './scheduler-dedupe';
import { emitEvent } from './events';
import { deliverEventToWebhooks } from './webhook-delivery';

export interface CreateScheduledPostInput {
  accountSlot: 1 | 2;
  text: string;
  scheduledTime: Date;
  communityId?: string | null;
  replyToTweetId?: string | null;
  mediaUrls?: string[];
  sourceUrl?: string | null;
  threadId?: string | null;
  threadIndex?: number | null;
  tags?: string[];
}

export async function createScheduledPost(input: CreateScheduledPostInput): Promise<{
  post: typeof scheduledPosts.$inferSelect;
  skipped: boolean;
}> {
  const extractedUrl = input.sourceUrl?.trim() || extractFirstUrl(input.text);
  const canonicalUrl = extractedUrl ? canonicalizeUrl(extractedUrl) : null;
  const normalizedCopy = normalizeCopy(input.text);
  const dedupeKey = canonicalUrl
    ? computeDedupeKey({ accountSlot: input.accountSlot, canonicalUrl, normalizedCopy })
    : null;

  if (dedupeKey) {
    const existing = await db
      .select()
      .from(scheduledPosts)
      .where(
        and(
          eq(scheduledPosts.accountSlot, input.accountSlot),
          eq(scheduledPosts.status, 'scheduled'),
          eq(scheduledPosts.dedupeKey, dedupeKey),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return { post: existing[0], skipped: true };
    }
  }

  const inserted = await db.insert(scheduledPosts).values({
    accountSlot: input.accountSlot,
    text: input.text,
    sourceUrl: canonicalUrl,
    dedupeKey,
    threadId: input.threadId ?? null,
    threadIndex: input.threadIndex ?? null,
    mediaUrls: JSON.stringify(input.mediaUrls ?? []),
    communityId: input.communityId ?? null,
    replyToTweetId: input.replyToTweetId ?? null,
    scheduledTime: input.scheduledTime,
    tags: input.tags?.length ? JSON.stringify(input.tags) : null,
  }).returning();

  const post = inserted[0];
  const payload = {
    scheduledTime: post.scheduledTime?.toISOString?.() ?? input.scheduledTime.toISOString(),
    sourceUrl: post.sourceUrl,
    threadId: post.threadId,
  };

  try {
    const eventId = emitEvent({
      eventType: 'post.scheduled',
      entityType: 'post',
      entityId: post.id,
      accountSlot: post.accountSlot,
      payload,
    });
    deliverEventToWebhooks(eventId, {
      eventType: 'post.scheduled',
      entityType: 'post',
      entityId: post.id,
      accountSlot: post.accountSlot,
      payload,
    });
  } catch {
    // Scheduling succeeds even if event fanout fails.
  }

  return { post, skipped: false };
}
