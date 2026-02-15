import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get('account_slot');
    const sortBy = url.searchParams.get('sort') || 'engagement';
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const sortMap: Record<string, string> = {
      engagement: '(pm.likes + pm.retweets + pm.replies + pm.quotes) DESC',
      impressions: 'pm.impressions DESC',
      likes: 'pm.likes DESC',
      retweets: 'pm.retweets DESC',
      recent: 'sp.updated_at DESC',
    };
    const orderClause = sortMap[sortBy] || sortMap.engagement;

    const slotFilter = slot ? 'AND sp.account_slot = ?' : '';
    const params: unknown[] = [];
    if (slot) params.push(Number(slot));

    const rows = sqlite.prepare(`
      SELECT
        sp.id,
        sp.text,
        sp.account_slot,
        sp.twitter_post_id,
        sp.scheduled_time,
        sp.updated_at,
        COALESCE(pm.impressions, 0) as impressions,
        COALESCE(pm.likes, 0) as likes,
        COALESCE(pm.retweets, 0) as retweets,
        COALESCE(pm.replies, 0) as replies,
        COALESCE(pm.quotes, 0) as quotes,
        COALESCE(pm.bookmarks, 0) as bookmarks
      FROM scheduled_posts sp
      LEFT JOIN (
        SELECT pm1.*
        FROM post_metrics pm1
        INNER JOIN (
          SELECT twitter_post_id, MAX(fetched_at) as max_fetched
          FROM post_metrics
          GROUP BY twitter_post_id
        ) pm2 ON pm1.twitter_post_id = pm2.twitter_post_id AND pm1.fetched_at = pm2.max_fetched
      ) pm ON sp.twitter_post_id = pm.twitter_post_id
      WHERE sp.status = 'posted'
        AND sp.twitter_post_id IS NOT NULL
        ${slotFilter}
      ORDER BY ${orderClause}
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<{
      id: number;
      text: string;
      account_slot: number;
      twitter_post_id: string;
      scheduled_time: number;
      updated_at: number;
      impressions: number;
      likes: number;
      retweets: number;
      replies: number;
      quotes: number;
      bookmarks: number;
    }>;

    return NextResponse.json({
      posts: rows.map((row) => ({
        ...row,
        engagement: row.likes + row.retweets + row.replies + row.quotes,
        engagementRate: row.impressions > 0
          ? Math.round(((row.likes + row.retweets + row.replies + row.quotes) / row.impressions) * 10000) / 100
          : 0,
      })),
    });
  } catch (error) {
    console.error('Analytics posts error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics posts.' }, { status: 500 });
  }
}
