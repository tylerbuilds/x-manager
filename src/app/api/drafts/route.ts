import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { draftPosts } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountSlot = url.searchParams.get('account_slot');
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    let query = db.select().from(draftPosts);
    if (accountSlot) {
      const slot = Number.parseInt(accountSlot, 10);
      if (slot === 1 || slot === 2) {
        query = query.where(eq(draftPosts.accountSlot, slot)) as typeof query;
      }
    }

    const rows = await query.orderBy(desc(draftPosts.createdAt)).limit(limit);
    return NextResponse.json({ drafts: rows });
  } catch (error) {
    console.error('Failed to list drafts:', error);
    return NextResponse.json({ error: 'Failed to list drafts.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      account_slot?: unknown;
      text?: unknown;
      media_urls?: unknown;
      community_id?: unknown;
      reply_to_tweet_id?: unknown;
      thread_id?: unknown;
      thread_index?: unknown;
      source?: unknown;
    };

    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'text is required.' }, { status: 400 });
    }

    const accountSlot = Number(body.account_slot || 1);
    if (accountSlot !== 1 && accountSlot !== 2) {
      return NextResponse.json({ error: 'account_slot must be 1 or 2.' }, { status: 400 });
    }

    const result = await db.insert(draftPosts).values({
      accountSlot,
      text,
      mediaUrls: Array.isArray(body.media_urls) ? JSON.stringify(body.media_urls) : null,
      communityId: typeof body.community_id === 'string' ? body.community_id : null,
      replyToTweetId: typeof body.reply_to_tweet_id === 'string' ? body.reply_to_tweet_id : null,
      threadId: typeof body.thread_id === 'string' ? body.thread_id : null,
      threadIndex: typeof body.thread_index === 'number' ? body.thread_index : null,
      source: typeof body.source === 'string' ? body.source : null,
    }).returning();

    return NextResponse.json({ ok: true, draft: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Failed to create draft:', error);
    return NextResponse.json({ error: 'Failed to create draft.' }, { status: 500 });
  }
}
