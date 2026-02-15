import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get('account_slot');
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') || 30)));

    const slotFilter = slot ? 'AND sp.account_slot = ?' : '';
    const params: unknown[] = [days];
    if (slot) params.push(Number(slot));

    // Daily aggregation: posts + latest metrics per day
    const rows = sqlite.prepare(`
      SELECT
        date(sp.updated_at, 'unixepoch') as day,
        COUNT(DISTINCT sp.id) as post_count,
        COALESCE(SUM(pm.impressions), 0) as impressions,
        COALESCE(SUM(pm.likes), 0) as likes,
        COALESCE(SUM(pm.retweets), 0) as retweets,
        COALESCE(SUM(pm.replies), 0) as replies
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
        AND sp.updated_at >= unixepoch() - (? * 86400)
        ${slotFilter}
      GROUP BY day
      ORDER BY day ASC
    `).all(...params) as Array<{
      day: string;
      post_count: number;
      impressions: number;
      likes: number;
      retweets: number;
      replies: number;
    }>;

    return NextResponse.json({
      period: { days },
      data: rows.map((row) => ({
        ...row,
        engagement: row.likes + row.retweets + row.replies,
      })),
    });
  } catch (error) {
    console.error('Analytics timeseries error:', error);
    return NextResponse.json({ error: 'Failed to fetch timeseries data.' }, { status: 500 });
  }
}
