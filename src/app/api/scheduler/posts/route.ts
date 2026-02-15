import crypto from 'crypto';
import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';
import { and, desc, eq, gte, lte, like, type SQL } from 'drizzle-orm';

import { db, sqlite } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { isAccountSlot, parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '@/lib/scheduler-dedupe';
import {
  ensureSafeUploadUrl,
  generateUploadFilename,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  toPublicPathFromMediaUrl,
} from '@/lib/uploads';
import { withIdempotency } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // ignore
  }
  return [];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    const search = url.searchParams.get('search')?.trim() || null;
    const dateFrom = url.searchParams.get('dateFrom') || null;
    const dateTo = url.searchParams.get('dateTo') || null;
    const statusFilter = url.searchParams.get('status') || null;
    const includeMetrics = url.searchParams.get('include_metrics') === 'true';

    const conditions: SQL[] = [];

    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      conditions.push(eq(scheduledPosts.accountSlot, parsed));
    }

    if (search) {
      conditions.push(like(scheduledPosts.text, `%${search}%`));
    }

    if (dateFrom) {
      const from = new Date(dateFrom);
      if (!Number.isNaN(from.getTime())) {
        conditions.push(gte(scheduledPosts.scheduledTime, from));
      }
    }

    if (dateTo) {
      const to = new Date(dateTo);
      if (!Number.isNaN(to.getTime())) {
        conditions.push(lte(scheduledPosts.scheduledTime, to));
      }
    }

    if (statusFilter) {
      const validStatuses = ['scheduled', 'posted', 'failed', 'cancelled'] as const;
      type PostStatus = (typeof validStatuses)[number];
      if (validStatuses.includes(statusFilter as PostStatus)) {
        conditions.push(eq(scheduledPosts.status, statusFilter as PostStatus));
      }
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const posts = await db
      .select()
      .from(scheduledPosts)
      .where(where)
      .orderBy(desc(scheduledPosts.createdAt));

    // Phase 7: Optionally join latest metrics for posted items
    if (includeMetrics) {
      try {
        const tweetIds = posts
          .filter((p) => p.twitterPostId)
          .map((p) => p.twitterPostId);

        if (tweetIds.length > 0) {
          const placeholders = tweetIds.map(() => '?').join(',');
          const metricsRows = sqlite.prepare(`
            SELECT pm1.*
            FROM post_metrics pm1
            INNER JOIN (
              SELECT twitter_post_id, MAX(fetched_at) as max_fetched
              FROM post_metrics
              WHERE twitter_post_id IN (${placeholders})
              GROUP BY twitter_post_id
            ) pm2 ON pm1.twitter_post_id = pm2.twitter_post_id AND pm1.fetched_at = pm2.max_fetched
          `).all(...tweetIds) as Array<{
            twitter_post_id: string;
            impressions: number;
            likes: number;
            retweets: number;
            replies: number;
            quotes: number;
            bookmarks: number;
          }>;

          const metricsMap = new Map(metricsRows.map((m) => [m.twitter_post_id, m]));

          return NextResponse.json(posts.map((post) => {
            const metrics = post.twitterPostId ? metricsMap.get(post.twitterPostId) : null;
            return {
              ...post,
              metrics: metrics ? {
                impressions: metrics.impressions,
                likes: metrics.likes,
                retweets: metrics.retweets,
                replies: metrics.replies,
                quotes: metrics.quotes,
                bookmarks: metrics.bookmarks,
              } : null,
            };
          }));
        }
      } catch {
        // Fall through to return without metrics
      }
    }

    return NextResponse.json(posts);
  } catch (error) {
    console.error('Error fetching scheduled posts:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return withIdempotency('scheduler-posts', req, async () => {
    try {
      const formData = await req.formData();

    const text = String(formData.get('text') || '');
    const scheduledTime = formData.get('scheduled_time') as string | null;
    const communityId = (formData.get('community_id') as string | null)?.trim() || null;
    const replyToTweetId = (formData.get('reply_to_tweet_id') as string | null)?.trim() || null;
    const threadIdRaw = (formData.get('thread_id') as string | null)?.trim() || null;
    const threadIndexRaw = (formData.get('thread_index') as string | null)?.trim() || null;
    const sourceUrlRaw = (formData.get('source_url') as string | null)?.trim() || null;

    const accountSlotRaw = formData.get('account_slot');
    let accountSlot: AccountSlot = 1;
    if (accountSlotRaw !== null) {
      const parsedSlot = parseAccountSlot(accountSlotRaw);
      if (!parsedSlot) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsedSlot;
    }

    const files = formData.getAll('files') as File[];

    if (!text.trim()) {
      return NextResponse.json({ error: 'Missing text.' }, { status: 400 });
    }

    if (!scheduledTime) {
      return NextResponse.json({ error: 'Missing scheduled_time.' }, { status: 400 });
    }

    const scheduledAt = new Date(scheduledTime);
    if (Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_time. Provide an ISO date string.' }, { status: 400 });
    }

    let threadId: string | null = threadIdRaw;
    let threadIndex: number | null = null;
    if (threadIndexRaw) {
      const parsed = Number(threadIndexRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        return NextResponse.json({ error: 'Invalid thread_index. Must be an integer >= 0.' }, { status: 400 });
      }
      threadIndex = parsed;
      if (!threadId) {
        return NextResponse.json({ error: 'thread_index requires thread_id.' }, { status: 400 });
      }
    } else if (threadId) {
      // Backwards-friendly default if callers set thread_id but omit the index.
      threadIndex = 0;
    }

    const extractedUrl = sourceUrlRaw || extractFirstUrl(text);
    const canonicalUrl = extractedUrl ? canonicalizeUrl(extractedUrl) : null;
    const normalizedCopy = normalizeCopy(text);
    const dedupeKey = canonicalUrl
      ? computeDedupeKey({ accountSlot, canonicalUrl, normalizedCopy })
      : null;

    if (dedupeKey) {
      const existing = await db
        .select()
        .from(scheduledPosts)
        .where(
          and(
            eq(scheduledPosts.accountSlot, accountSlot),
            eq(scheduledPosts.status, 'scheduled'),
            eq(scheduledPosts.dedupeKey, dedupeKey),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        return NextResponse.json({ ...existing[0], skipped: true });
      }
    }

    if (files.length > MAX_UPLOAD_FILES) {
      return NextResponse.json(
        { error: `Too many files. X supports up to ${MAX_UPLOAD_FILES} media attachments.` },
        { status: 400 },
      );
    }

    const mediaUrls: string[] = [];
    if (files.length > 0) {
      const uploadDir = path.join(process.cwd(), 'public', 'uploads');
      await fs.mkdir(uploadDir, { recursive: true });

      for (const file of files) {
        if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json(
            { error: `File too large. Max ${MAX_UPLOAD_BYTES} bytes per upload.` },
            { status: 400 },
          );
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const filename = generateUploadFilename(file.name || `upload-${crypto.randomUUID()}`);
        await fs.writeFile(path.join(uploadDir, filename), buffer);
        mediaUrls.push(`/uploads/${filename}`);
      }
    }

    const newPost = {
      accountSlot,
      text,
      sourceUrl: canonicalUrl,
      dedupeKey,
      threadId,
      threadIndex,
      scheduledTime: scheduledAt,
      communityId,
      replyToTweetId,
      mediaUrls: JSON.stringify(mediaUrls),
    };

    try {
      const inserted = await db.insert(scheduledPosts).values(newPost).returning();
      return NextResponse.json(inserted[0]);
    } catch (error) {
      // If we race with another insert, the unique index can reject duplicates; return the existing row.
      const message = error instanceof Error ? error.message : String(error);
      if (dedupeKey && message.includes('SQLITE_CONSTRAINT')) {
        const existing = await db
          .select()
          .from(scheduledPosts)
          .where(
            and(
              eq(scheduledPosts.accountSlot, accountSlot),
              eq(scheduledPosts.status, 'scheduled'),
              eq(scheduledPosts.dedupeKey, dedupeKey),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          return NextResponse.json({ ...existing[0], skipped: true });
        }
      }
      throw error;
    }
    } catch (error) {
      console.error('Error creating scheduled post:', error);
      return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
    }
  });
}

export async function DELETE() {
  try {
    const allPosts = await db.select().from(scheduledPosts);

    for (const post of allPosts) {
      const urls = parseJsonArray(post.mediaUrls);
      for (const rawUrl of urls) {
        const safeUrl = ensureSafeUploadUrl(rawUrl);
        if (!safeUrl) continue;

        try {
          await fs.unlink(toPublicPathFromMediaUrl(safeUrl));
        } catch (error) {
          console.error(`Failed to delete media file: ${safeUrl}`, error);
        }
      }
    }

    await db.delete(scheduledPosts);

    return NextResponse.json({ message: 'All scheduled posts deleted successfully' });
  } catch (error) {
    console.error('Error deleting all scheduled posts:', error);
    return NextResponse.json({ error: 'Failed to delete all posts' }, { status: 500 });
  }
}
