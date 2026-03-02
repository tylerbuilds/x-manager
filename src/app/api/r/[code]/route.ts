import crypto from 'crypto';
import { resolveShortUrl, recordClick } from '@/lib/url-shortener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/r/:code — 301 redirect + record click.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const shortUrl = resolveShortUrl(code);

  if (!shortUrl) {
    return new Response('Not found', { status: 404 });
  }

  // Build target URL with UTM params if present
  let target = shortUrl.target_url;
  try {
    const targetUrl = new URL(target);
    if (shortUrl.utm_source) targetUrl.searchParams.set('utm_source', shortUrl.utm_source);
    if (shortUrl.utm_medium) targetUrl.searchParams.set('utm_medium', shortUrl.utm_medium);
    if (shortUrl.utm_campaign) targetUrl.searchParams.set('utm_campaign', shortUrl.utm_campaign);
    target = targetUrl.toString();
  } catch {
    // If URL parsing fails, redirect as-is
  }

  // Record click asynchronously (don't block redirect)
  const referer = req.headers.get('referer') ?? undefined;
  const userAgent = req.headers.get('user-agent') ?? undefined;
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : undefined;
  const ipSalt = process.env.X_MANAGER_ENCRYPTION_KEY || 'x-manager-click-salt';
  const ipHash = ip
    ? crypto.createHash('sha256').update(`${ipSalt}:${ip}`).digest('hex').slice(0, 16)
    : undefined;

  try {
    recordClick(shortUrl.id, { referer, userAgent, ipHash });
  } catch {
    // Don't fail redirect on click recording error
  }

  return new Response(null, {
    status: 301,
    headers: {
      Location: target,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
