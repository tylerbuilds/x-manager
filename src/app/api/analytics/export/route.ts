import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';
import { isAccountSlot } from '@/lib/account-slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ExportRow {
  id: number;
  account_slot: number;
  text: string;
  source_url: string | null;
  scheduled_time: number;
  status: string;
  twitter_post_id: string | null;
  created_at: number;
  impressions: number | null;
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  click_count: number | null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const format = url.searchParams.get('format') || 'json';
    const periodDays = Math.min(365, Math.max(1, Number(url.searchParams.get('period')?.replace('d', '')) || 30));
    const slotParam = url.searchParams.get('account_slot');

    if (format !== 'json' && format !== 'csv') {
      return NextResponse.json({ error: 'Invalid format. Use "json" or "csv".' }, { status: 400 });
    }

    const since = Math.floor(Date.now() / 1000) - periodDays * 86400;
    const params: unknown[] = [since];
    let slotFilter = '';

    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      slotFilter = 'AND sp.account_slot = ?';
      params.push(parsed);
    }

    const rows = sqlite
      .prepare(
        `SELECT
          sp.id,
          sp.account_slot,
          sp.text,
          sp.source_url,
          sp.scheduled_time,
          sp.status,
          sp.twitter_post_id,
          sp.created_at,
          pm.impressions,
          pm.likes,
          pm.retweets,
          pm.replies,
          pm.quotes,
          pm.bookmarks,
          su.click_count
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
        LEFT JOIN short_urls su ON su.post_id = sp.id
        WHERE sp.scheduled_time >= ?
          ${slotFilter}
        ORDER BY sp.scheduled_time DESC`,
      )
      .all(...params) as ExportRow[];

    // CSV injection prevention: prefix formula-triggering characters with a single quote
    const sanitizeCsvCell = (value: string): string => {
      if (/^[=+\-@\t\r]/.test(value)) return `'${value}`;
      return value;
    };

    if (format === 'csv') {
      const headers = [
        'id', 'account_slot', 'text', 'source_url', 'scheduled_time', 'posted_time',
        'status', 'twitter_post_id', 'impressions', 'likes', 'retweets',
        'replies', 'quotes', 'bookmarks', 'engagement_rate', 'url_clicks',
      ];

      // S12 fix: Quote all string fields to prevent CSV corruption from commas/newlines
      const quoteCsv = (value: string): string => {
        const sanitized = sanitizeCsvCell(value);
        return `"${sanitized.replace(/"/g, '""')}"`;
      };

      const csvRows = rows.map((r) => {
        const totalEngagement = (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0) + (r.quotes ?? 0);
        const engagementRate = r.impressions && r.impressions > 0
          ? Math.round((totalEngagement / r.impressions) * 10000) / 100
          : 0;

        return [
          r.id,
          r.account_slot,
          quoteCsv(r.text || ''),
          quoteCsv(r.source_url ?? ''),
          quoteCsv(new Date(r.scheduled_time * 1000).toISOString()),
          quoteCsv(r.status === 'posted' ? new Date(r.scheduled_time * 1000).toISOString() : ''),
          quoteCsv(r.status),
          quoteCsv(r.twitter_post_id ?? ''),
          r.impressions ?? '',
          r.likes ?? '',
          r.retweets ?? '',
          r.replies ?? '',
          r.quotes ?? '',
          r.bookmarks ?? '',
          r.impressions ? `${engagementRate}%` : '',
          r.click_count ?? '',
        ].join(',');
      });

      const csv = [headers.join(','), ...csvRows].join('\n');

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="x-manager-export-${periodDays}d.csv"`,
        },
      });
    }

    // JSON format
    const jsonRows = rows.map((r) => {
      const totalEngagement = (r.likes ?? 0) + (r.retweets ?? 0) + (r.replies ?? 0) + (r.quotes ?? 0);
      const engagementRate = r.impressions && r.impressions > 0
        ? Math.round((totalEngagement / r.impressions) * 10000) / 100
        : null;

      return {
        id: r.id,
        accountSlot: r.account_slot,
        text: r.text,
        sourceUrl: r.source_url,
        scheduledTime: new Date(r.scheduled_time * 1000).toISOString(),
        status: r.status,
        twitterPostId: r.twitter_post_id,
        metrics: r.impressions != null ? {
          impressions: r.impressions,
          likes: r.likes ?? 0,
          retweets: r.retweets ?? 0,
          replies: r.replies ?? 0,
          quotes: r.quotes ?? 0,
          bookmarks: r.bookmarks ?? 0,
          engagementRate,
        } : null,
        urlClicks: r.click_count ?? 0,
      };
    });

    return NextResponse.json({
      period: `${periodDays}d`,
      total: jsonRows.length,
      posts: jsonRows,
    });
  } catch (error) {
    console.error('Error exporting analytics:', error);
    return NextResponse.json({ error: 'Failed to export analytics.' }, { status: 500 });
  }
}
