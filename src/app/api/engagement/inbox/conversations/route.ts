import { desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, sqlite } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountSlot = url.searchParams.get('account_slot');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));

    // Use raw SQL for efficient grouping
    const query = `
      SELECT
        COALESCE(in_reply_to_tweet_id, source_id) as thread_root,
        COUNT(*) as message_count,
        MAX(created_at) as last_activity,
        GROUP_CONCAT(id) as item_ids,
        MIN(status) as status
      FROM engagement_inbox
      ${accountSlot ? 'WHERE account_slot = ?' : ''}
      GROUP BY thread_root
      ORDER BY last_activity DESC
      LIMIT ?
    `;

    const params = accountSlot ? [Number(accountSlot), limit] : [limit];
    const conversations = sqlite.prepare(query).all(...params) as Array<{
      thread_root: string;
      message_count: number;
      last_activity: number;
      item_ids: string;
      status: string;
    }>;

    return NextResponse.json({
      conversations: conversations.map(c => ({
        threadRoot: c.thread_root,
        messageCount: c.message_count,
        lastActivity: c.last_activity,
        itemIds: c.item_ids.split(',').map(Number),
        status: c.status,
      })),
    });
  } catch (error) {
    console.error('Failed to list conversations:', error);
    return NextResponse.json({ error: 'Failed to list conversations.' }, { status: 500 });
  }
}
