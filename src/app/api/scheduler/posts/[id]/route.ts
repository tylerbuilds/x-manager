import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';
import { parseAccountSlot, type AccountSlot } from '@/lib/account-slots';
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

async function deleteMediaFiles(urls: string[]): Promise<void> {
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

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const postId = Number.parseInt(params.id, 10);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'Invalid post id.' }, { status: 400 });
    }

    const formData = await req.formData();
    const text = String(formData.get('text') || '');
    const scheduledTime = formData.get('scheduled_time') as string | null;
    const communityId = (formData.get('community_id') as string | null)?.trim() || null;
    const replyToTweetId = (formData.get('reply_to_tweet_id') as string | null)?.trim() || null;
    const sourceUrlRaw = (formData.get('source_url') as string | null)?.trim() || null;

    const existingPost = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1);
    if (existingPost.length === 0) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const accountSlotRaw = formData.get('account_slot');
    let accountSlot: AccountSlot = existingPost[0].accountSlot as AccountSlot;
    if (accountSlotRaw !== null) {
      const parsed = parseAccountSlot(accountSlotRaw);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    const files = formData.getAll('files') as File[];
    if (files.length > MAX_UPLOAD_FILES) {
      return NextResponse.json(
        { error: `Too many files. X supports up to ${MAX_UPLOAD_FILES} media attachments.` },
        { status: 400 },
      );
    }

    const oldMediaUrls = parseJsonArray(existingPost[0].mediaUrls);

    const mediaUrls: string[] = [];
    if (files.length > 0) {
      await deleteMediaFiles(oldMediaUrls);

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
    } else {
      mediaUrls.push(...oldMediaUrls);
    }

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

    const extractedUrl = sourceUrlRaw || extractFirstUrl(text);
    const canonicalUrl = extractedUrl ? canonicalizeUrl(extractedUrl) : null;
    const normalizedCopy = normalizeCopy(text);
    const dedupeKey = canonicalUrl
      ? computeDedupeKey({ accountSlot, canonicalUrl, normalizedCopy })
      : null;

    const updatedPost = {
      accountSlot,
      text,
      sourceUrl: canonicalUrl,
      dedupeKey,
      scheduledTime: scheduledAt,
      communityId,
      replyToTweetId,
      mediaUrls: JSON.stringify(mediaUrls),
      updatedAt: new Date(),
    };

    const result = await db
      .update(scheduledPosts)
      .set(updatedPost)
      .where(eq(scheduledPosts.id, postId))
      .returning();

    return NextResponse.json(result[0]);
  } catch (error) {
    console.error(`Error updating post ${params.id}:`, error);
    return NextResponse.json({ error: 'Failed to update post' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const postId = Number.parseInt(params.id, 10);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'Invalid post id.' }, { status: 400 });
    }

    const existingPost = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1);
    if (existingPost.length > 0) {
      await deleteMediaFiles(parseJsonArray(existingPost[0].mediaUrls));
    }

    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, postId));
    return NextResponse.json({ message: 'Post deleted' });
  } catch (error) {
    console.error(`Error deleting post ${params.id}:`, error);
    return NextResponse.json({ error: 'Failed to delete post' }, { status: 500 });
  }
}
