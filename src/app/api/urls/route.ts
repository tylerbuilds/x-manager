import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';
import { createShortUrl } from '@/lib/url-shortener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const countRow = sqlite
      .prepare(`SELECT COUNT(*) as total FROM short_urls`)
      .get() as { total: number };
    const total = countRow.total;

    const rows = sqlite
      .prepare(
        `SELECT * FROM short_urls ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
      id: number;
      short_code: string;
      target_url: string;
      utm_source: string | null;
      utm_medium: string | null;
      utm_campaign: string | null;
      click_count: number;
      post_id: number | null;
      created_at: number;
    }>;

    return NextResponse.json({
      urls: rows.map((r) => ({
        id: r.id,
        shortCode: r.short_code,
        targetUrl: r.target_url,
        utmSource: r.utm_source,
        utmMedium: r.utm_medium,
        utmCampaign: r.utm_campaign,
        clickCount: r.click_count,
        postId: r.post_id,
        createdAt: new Date(r.created_at * 1000).toISOString(),
      })),
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Error listing short URLs:', error);
    return NextResponse.json({ error: 'Failed to list short URLs.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const targetUrl = typeof body.target_url === 'string' ? body.target_url.trim() : '';
    if (!targetUrl) {
      return NextResponse.json({ error: 'target_url is required.' }, { status: 400 });
    }

    // Basic URL validation
    try {
      new URL(targetUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid target_url. Provide a valid URL.' }, { status: 400 });
    }

    const row = createShortUrl({
      targetUrl,
      utmSource: typeof body.utm_source === 'string' ? body.utm_source.trim() || undefined : undefined,
      utmMedium: typeof body.utm_medium === 'string' ? body.utm_medium.trim() || undefined : undefined,
      utmCampaign: typeof body.utm_campaign === 'string' ? body.utm_campaign.trim() || undefined : undefined,
      postId: typeof body.post_id === 'number' && Number.isFinite(body.post_id) ? body.post_id : undefined,
    });

    return NextResponse.json({
      id: row.id,
      shortCode: row.short_code,
      targetUrl: row.target_url,
      utmSource: row.utm_source,
      utmMedium: row.utm_medium,
      utmCampaign: row.utm_campaign,
      clickCount: row.click_count,
      postId: row.post_id,
      createdAt: new Date(row.created_at * 1000).toISOString(),
    });
  } catch (error) {
    console.error('Error creating short URL:', error);
    return NextResponse.json({ error: 'Failed to create short URL.' }, { status: 500 });
  }
}
