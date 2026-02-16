/**
 * Global API rate limiter using a sliding-window counter per IP.
 * In-memory only (resets on restart) - appropriate for a single-instance tool.
 */

type Bucket = {
  minute: number;
  count: number;
};

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 4096;

export type RateLimitConfig = {
  /** Requests per minute per IP. Default: 120 */
  perMinute?: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfter: number;
};

function prune(currentMinute: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.minute < currentMinute - 2) {
      buckets.delete(key);
    }
  }
}

export function checkGlobalRateLimit(clientIp: string, config: RateLimitConfig = {}): RateLimitResult {
  const limit = config.perMinute ?? 120;
  const minute = Math.floor(Date.now() / 60_000);

  prune(minute);

  const existing = buckets.get(clientIp);

  if (!existing || existing.minute !== minute) {
    buckets.set(clientIp, { minute, count: 1 });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (existing.count >= limit) {
    const elapsed = Math.floor((Date.now() % 60_000) / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(1, 60 - elapsed) };
  }

  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, retryAfter: 0 };
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwarded.split(',')[0]?.trim();
    if (ip) return ip;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'local';
}
