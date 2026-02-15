import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get('account_slot');
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days') || 90)));

    const slotFilter = slot ? 'AND sp.account_slot = ?' : '';
    const params: unknown[] = [days];
    if (slot) params.push(Number(slot));

    // Aggregate engagement by day-of-week (0=Sun) and hour
    const rows = sqlite.prepare(`
      SELECT
        CAST(strftime('%w', sp.scheduled_time, 'unixepoch') AS INTEGER) as day_of_week,
        CAST(strftime('%H', sp.scheduled_time, 'unixepoch') AS INTEGER) as hour,
        COUNT(DISTINCT sp.id) as post_count,
        COALESCE(AVG(pm.likes + pm.retweets + pm.replies + pm.quotes), 0) as avg_engagement,
        COALESCE(AVG(pm.impressions), 0) as avg_impressions
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
        AND sp.scheduled_time >= unixepoch() - (? * 86400)
        ${slotFilter}
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
    `).all(...params) as Array<{
      day_of_week: number;
      hour: number;
      post_count: number;
      avg_engagement: number;
      avg_impressions: number;
    }>;

    // Build 7x24 heatmap grid
    const heatmap: Array<{ dayOfWeek: number; hour: number; avgEngagement: number; avgImpressions: number; postCount: number }> = [];
    const dataMap = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      dataMap.set(`${row.day_of_week}-${row.hour}`, row);
    }

    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const entry = dataMap.get(`${d}-${h}`);
        heatmap.push({
          dayOfWeek: d,
          hour: h,
          avgEngagement: entry ? Math.round(entry.avg_engagement * 100) / 100 : 0,
          avgImpressions: entry ? Math.round(entry.avg_impressions) : 0,
          postCount: entry?.post_count || 0,
        });
      }
    }

    // Find top 5 best time slots
    const bestSlots = [...heatmap]
      .filter((s) => s.postCount > 0)
      .sort((a, b) => b.avgEngagement - a.avgEngagement)
      .slice(0, 5);

    return NextResponse.json({
      period: { days },
      heatmap,
      bestSlots,
    });
  } catch (error) {
    console.error('Analytics best-times error:', error);
    return NextResponse.json({ error: 'Failed to fetch best times data.' }, { status: 500 });
  }
}
