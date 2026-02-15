import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { draftPosts } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const draftId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid draft id.' }, { status: 400 });
  }

  const rows = await db.select().from(draftPosts).where(eq(draftPosts.id, draftId)).limit(1);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  }

  return NextResponse.json({ draft: rows[0] });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const draftId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid draft id.' }, { status: 400 });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (typeof body.text === 'string') updates.text = body.text.trim();
    if (body.media_urls !== undefined) updates.mediaUrls = Array.isArray(body.media_urls) ? JSON.stringify(body.media_urls) : null;
    if (body.community_id !== undefined) updates.communityId = typeof body.community_id === 'string' ? body.community_id : null;
    if (body.reply_to_tweet_id !== undefined) updates.replyToTweetId = typeof body.reply_to_tweet_id === 'string' ? body.reply_to_tweet_id : null;
    if (body.source !== undefined) updates.source = typeof body.source === 'string' ? body.source : null;

    const updated = await db.update(draftPosts).set(updates).where(eq(draftPosts.id, draftId)).returning();
    if (updated.length === 0) {
      return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, draft: updated[0] });
  } catch (error) {
    console.error('Failed to update draft:', error);
    return NextResponse.json({ error: 'Failed to update draft.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const draftId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(draftId) || draftId <= 0) {
    return NextResponse.json({ error: 'Invalid draft id.' }, { status: 400 });
  }

  const deleted = await db.delete(draftPosts).where(eq(draftPosts.id, draftId)).returning();
  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
