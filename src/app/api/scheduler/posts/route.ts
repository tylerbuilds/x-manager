import crypto from 'crypto';
import fs from 'fs/promises';
import { NextResponse } from 'next/server';
import path from 'path';
import { and, desc, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
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
    let slot: AccountSlot | null = null;

    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      slot = parsed;
    }

    const posts = slot
      ? await db
          .select()
          .from(scheduledPosts)
          .where(eq(scheduledPosts.accountSlot, slot))
          .orderBy(desc(scheduledPosts.createdAt))
      : await db.select().from(scheduledPosts).orderBy(desc(scheduledPosts.createdAt));

    return NextResponse.json(posts);
  } catch (error) {
    console.error('Error fetching scheduled posts:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}

export async function POST(req: Request) {
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
