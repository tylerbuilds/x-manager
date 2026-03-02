import { NextResponse } from 'next/server';

import { sqlite } from '@/lib/db';
import { isAccountSlot } from '@/lib/account-slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ThreadRow {
  thread_id: string;
  post_count: number;
  account_slot: number;
  source_url: string | null;
  first_tweet_text: string | null;
  scheduled_time: number | null;
  status_scheduled: number;
  status_posted: number;
  status_failed: number;
  status_cancelled: number;
  created_at: number | null;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    // --- Parse & validate query params ---

    const accountSlotParam = url.searchParams.get('account_slot');
    let accountSlotFilter: number | null = null;
    if (accountSlotParam !== null) {
      const parsed = Number(accountSlotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json(
          { error: 'Invalid account_slot. Use 1 or 2.' },
          { status: 400 },
        );
      }
      accountSlotFilter = parsed;
    }

    const statusParam = url.searchParams.get('status');
    const validStatuses = ['scheduled', 'posted', 'failed', 'cancelled'] as const;
    if (statusParam !== null && !validStatuses.includes(statusParam as (typeof validStatuses)[number])) {
      return NextResponse.json(
        { error: `Invalid status. Use one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const limitParam = url.searchParams.get('limit');
    const limit = Math.max(1, Math.min(1000, Number(limitParam) || 100));

    const offsetParam = url.searchParams.get('offset');
    const offset = Math.max(0, Number(offsetParam) || 0);

    // --- Build SQL ---

    const whereClauses: string[] = ['thread_id IS NOT NULL'];
    const params: (string | number)[] = [];

    if (accountSlotFilter !== null) {
      whereClauses.push('account_slot = ?');
      params.push(accountSlotFilter);
    }

    if (statusParam !== null) {
      whereClauses.push('status = ?');
      params.push(statusParam);
    }

    const whereSQL = whereClauses.join(' AND ');

    // Count total distinct threads matching filters
    const countRow = sqlite
      .prepare(
        `SELECT COUNT(DISTINCT thread_id) AS total
         FROM scheduled_posts
         WHERE ${whereSQL}`,
      )
      .get(...params) as { total: number } | undefined;

    const total = countRow?.total ?? 0;

    // Main aggregation query: group by thread_id with per-status counts
    // and first-tweet data (thread_index = 0 or MIN thread_index).
    const rows = sqlite
      .prepare(
        `SELECT
           sp.thread_id,
           sp.post_count,
           sp.account_slot,
           sp.status_scheduled,
           sp.status_posted,
           sp.status_failed,
           sp.status_cancelled,
           sp.created_at,
           first.source_url,
           first.text AS first_tweet_text,
           first.scheduled_time
         FROM (
           SELECT
             thread_id,
             COUNT(*) AS post_count,
             account_slot,
             SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) AS status_scheduled,
             SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS status_posted,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS status_failed,
             SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS status_cancelled,
             MIN(created_at) AS created_at
           FROM scheduled_posts
           WHERE ${whereSQL}
           GROUP BY thread_id
         ) sp
         LEFT JOIN scheduled_posts first
           ON first.thread_id = sp.thread_id
           AND first.thread_index = (
             SELECT MIN(thread_index) FROM scheduled_posts WHERE thread_id = sp.thread_id
           )
         ORDER BY first.scheduled_time DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as ThreadRow[];

    const threads = rows.map((row) => ({
      threadId: row.thread_id,
      postCount: row.post_count,
      accountSlot: row.account_slot,
      sourceUrl: row.source_url,
      firstTweetText: row.first_tweet_text
        ? row.first_tweet_text.length > 100
          ? row.first_tweet_text.slice(0, 100) + '...'
          : row.first_tweet_text
        : null,
      scheduledTime: row.scheduled_time
        ? new Date(row.scheduled_time * 1000).toISOString()
        : null,
      status: {
        ...(row.status_scheduled > 0 ? { scheduled: row.status_scheduled } : {}),
        ...(row.status_posted > 0 ? { posted: row.status_posted } : {}),
        ...(row.status_failed > 0 ? { failed: row.status_failed } : {}),
        ...(row.status_cancelled > 0 ? { cancelled: row.status_cancelled } : {}),
      },
      createdAt: row.created_at
        ? new Date(row.created_at * 1000).toISOString()
        : null,
    }));

    return NextResponse.json({
      threads,
      total,
      offset,
      limit,
      hasMore: offset + threads.length < total,
    });
  } catch (error) {
    console.error('Error fetching threads:', error);
    return NextResponse.json(
      { error: 'Failed to fetch threads' },
      { status: 500 },
    );
  }
}
