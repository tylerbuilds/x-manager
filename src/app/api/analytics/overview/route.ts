import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slot = url.searchParams.get('account_slot');
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days') || 30)));

    const slotFilter = slot ? 'AND sp.account_slot = ?' : '';
    const params: unknown[] = [days];
    if (slot) params.push(Number(slot));

    // Get total posted count
    const postCountRow = sqlite.prepare(`
      SELECT COUNT(*) as total FROM scheduled_posts sp
      WHERE sp.status = 'posted'
        AND sp.updated_at >= unixepoch() - (? * 86400)
        ${slotFilter}
    `).get(...params) as { total: number };

    // Get aggregate metrics from latest snapshot per tweet
    const metricsRow = sqlite.prepare(`
      SELECT
        COALESCE(SUM(pm.impressions), 0) as total_impressions,
        COALESCE(SUM(pm.likes), 0) as total_likes,
        COALESCE(SUM(pm.retweets), 0) as total_retweets,
        COALESCE(SUM(pm.replies), 0) as total_replies,
        COALESCE(SUM(pm.quotes), 0) as total_quotes,
        COALESCE(SUM(pm.bookmarks), 0) as total_bookmarks
      FROM post_metrics pm
      INNER JOIN (
        SELECT twitter_post_id, MAX(fetched_at) as max_fetched
        FROM post_metrics
        WHERE fetched_at >= unixepoch() - (? * 86400)
        ${slot ? 'AND account_slot = ?' : ''}
        GROUP BY twitter_post_id
      ) latest ON pm.twitter_post_id = latest.twitter_post_id AND pm.fetched_at = latest.max_fetched
    `).get(...params) as {
      total_impressions: number;
      total_likes: number;
      total_retweets: number;
      total_replies: number;
      total_quotes: number;
      total_bookmarks: number;
    } | undefined;

    const m = metricsRow || { total_impressions: 0, total_likes: 0, total_retweets: 0, total_replies: 0, total_quotes: 0, total_bookmarks: 0 };
    const totalEngagements = m.total_likes + m.total_retweets + m.total_replies + m.total_quotes;
    const engagementRate = m.total_impressions > 0 ? (totalEngagements / m.total_impressions) * 100 : 0;

    return NextResponse.json({
      period: { days },
      totalPosts: postCountRow.total,
      impressions: m.total_impressions,
      likes: m.total_likes,
      retweets: m.total_retweets,
      replies: m.total_replies,
      quotes: m.total_quotes,
      bookmarks: m.total_bookmarks,
      totalEngagements,
      engagementRate: Math.round(engagementRate * 100) / 100,
    });
  } catch (error) {
    console.error('Analytics overview error:', error);
    return NextResponse.json({ error: 'Failed to fetch analytics overview.' }, { status: 500 });
  }
}
