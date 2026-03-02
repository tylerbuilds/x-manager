import crypto from 'crypto';
import { sqlite } from '@/lib/db';

const CODE_LENGTH = 7;
const CODE_CHARS = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function generateShortCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

interface ShortenOptions {
  targetUrl: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  postId?: number;
}

interface ShortUrlRow {
  id: number;
  short_code: string;
  target_url: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  click_count: number;
  post_id: number | null;
  created_at: number;
}

export function createShortUrl(options: ShortenOptions): ShortUrlRow {
  const { targetUrl, utmSource, utmMedium, utmCampaign, postId } = options;

  // Try up to 5 times to generate a unique code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateShortCode();
    try {
      sqlite
        .prepare(
          `INSERT INTO short_urls (short_code, target_url, utm_source, utm_medium, utm_campaign, post_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
        )
        .run(code, targetUrl, utmSource ?? null, utmMedium ?? null, utmCampaign ?? null, postId ?? null);

      return sqlite
        .prepare(`SELECT * FROM short_urls WHERE short_code = ?`)
        .get(code) as ShortUrlRow;
    } catch (error) {
      // UNIQUE constraint violation — retry with new code
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('UNIQUE') && attempt < 4) continue;
      throw error;
    }
  }

  throw new Error('Failed to generate unique short code after 5 attempts');
}

export function resolveShortUrl(code: string): ShortUrlRow | null {
  return (
    sqlite
      .prepare(`SELECT * FROM short_urls WHERE short_code = ?`)
      .get(code) as ShortUrlRow | undefined
  ) ?? null;
}

export function recordClick(
  shortUrlId: number,
  options: { referer?: string; userAgent?: string; ipHash?: string },
): void {
  sqlite
    .prepare(
      `INSERT INTO url_clicks (short_url_id, referer, user_agent, ip_hash, clicked_at)
       VALUES (?, ?, ?, ?, unixepoch())`,
    )
    .run(shortUrlId, options.referer ?? null, options.userAgent ?? null, options.ipHash ?? null);

  // Atomic increment
  sqlite
    .prepare(`UPDATE short_urls SET click_count = click_count + 1 WHERE id = ?`)
    .run(shortUrlId);
}

export function getClickStats(shortUrlId: number, days = 30): {
  totalClicks: number;
  clicksByDay: Array<{ date: string; clicks: number }>;
} {
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const totalRow = sqlite
    .prepare(`SELECT click_count FROM short_urls WHERE id = ?`)
    .get(shortUrlId) as { click_count: number } | undefined;

  const clicksByDay = sqlite
    .prepare(
      `SELECT date(clicked_at, 'unixepoch') as date, COUNT(*) as clicks
       FROM url_clicks
       WHERE short_url_id = ? AND clicked_at >= ?
       GROUP BY date(clicked_at, 'unixepoch')
       ORDER BY date ASC`,
    )
    .all(shortUrlId, since) as Array<{ date: string; clicks: number }>;

  return {
    totalClicks: totalRow?.click_count ?? 0,
    clicksByDay,
  };
}
