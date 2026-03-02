import { NextResponse } from 'next/server';
import { resolveShortUrl, getClickStats } from '@/lib/url-shortener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/urls/:code/stats — Click analytics for a short URL.
 * Note: The actual redirect happens at /r/:code (see below).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const shortUrl = resolveShortUrl(code);

    if (!shortUrl) {
      return NextResponse.json({ error: 'Short URL not found.' }, { status: 404 });
    }

    const url = new URL(req.url);
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get('days')) || 30));
    const stats = getClickStats(shortUrl.id, days);

    return NextResponse.json({
      id: shortUrl.id,
      shortCode: shortUrl.short_code,
      targetUrl: shortUrl.target_url,
      utmSource: shortUrl.utm_source,
      utmMedium: shortUrl.utm_medium,
      utmCampaign: shortUrl.utm_campaign,
      clickCount: shortUrl.click_count,
      postId: shortUrl.post_id,
      createdAt: new Date(shortUrl.created_at * 1000).toISOString(),
      stats,
    });
  } catch (error) {
    console.error('Error fetching short URL stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats.' }, { status: 500 });
  }
}

/**
 * DELETE /api/urls/:code — Delete a short URL.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await params;
    const shortUrl = resolveShortUrl(code);

    if (!shortUrl) {
      return NextResponse.json({ error: 'Short URL not found.' }, { status: 404 });
    }

    const { sqlite } = await import('@/lib/db');
    sqlite.exec('BEGIN');
    try {
      sqlite.prepare(`DELETE FROM url_clicks WHERE short_url_id = ?`).run(shortUrl.id);
      sqlite.prepare(`DELETE FROM short_urls WHERE id = ?`).run(shortUrl.id);
      sqlite.exec('COMMIT');
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }

    return NextResponse.json({ ok: true, deleted: code });
  } catch (error) {
    console.error('Error deleting short URL:', error);
    return NextResponse.json({ error: 'Failed to delete short URL.' }, { status: 500 });
  }
}
