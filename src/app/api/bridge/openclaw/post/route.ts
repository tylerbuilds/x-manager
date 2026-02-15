import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { xAccounts } from '@/lib/db/schema';
import { getResolvedXConfig } from '@/lib/x-config';
import { postTweet, uploadMedia } from '@/lib/twitter-api-client';
import { decryptAccountTokens } from '@/lib/x-account-crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MEDIA_ITEMS = 4;
const MAX_MEDIA_BYTES = 8_000_000;
const MAX_TWEET_CHARS = 280;
const MAX_BODY_BYTES = 200_000;
const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 20;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;

type RateBucket = {
  minute: number;
  count: number;
};

const replayCache = new Map<string, number>();
const rateBuckets = new Map<string, RateBucket>();

type BridgePostBody = {
  text?: unknown;
  tweet_text?: unknown;
  tweet?: unknown;
  content?: unknown;
  message?: unknown;
  body?: unknown;
  account_slot?: unknown;
  accountSlot?: unknown;
  slot?: unknown;
  account?: unknown;
  account_handle?: unknown;
  accountHandle?: unknown;
  username?: unknown;
  handle?: unknown;
  media_urls?: unknown;
  mediaUrls?: unknown;
  media_url?: unknown;
  mediaUrl?: unknown;
  image_urls?: unknown;
  imageUrls?: unknown;
  image_url?: unknown;
  imageUrl?: unknown;
  images?: unknown;
  files?: unknown;
  community_id?: unknown;
  communityId?: unknown;
  reply_to_tweet_id?: unknown;
  replyToTweetId?: unknown;
  reply_to?: unknown;
  replyTo?: unknown;
  dry_run?: unknown;
  dryRun?: unknown;
  simulate?: unknown;
};

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim().length === 0) return false;
  return true;
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function noStoreJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function mediaEntryToString(value: unknown): string | null {
  const direct = asString(value);
  if (direct) return direct;

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const candidate = asString(record.url) || asString(record.src) || asString(record.path);
    if (candidate) return candidate;
  }

  return null;
}

function parseMediaList(value: unknown): string[] {
  if (!isProvided(value)) return [];

  if (Array.isArray(value)) {
    return value
      .map((entry) => mediaEntryToString(entry))
      .filter((entry): entry is string => Boolean(entry));
  }

  const text = asString(value);
  if (!text) return [];

  if (text.startsWith('[') && text.endsWith(']')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => mediaEntryToString(entry))
          .filter((entry): entry is string => Boolean(entry));
      }
    } catch {
      // Fallback below.
    }
  }

  if (text.includes(',')) {
    return text
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [text];
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function parseAllowedSlots(raw: string | undefined): Set<number> {
  const result = new Set<number>();
  const text = (raw || '').trim();
  if (text.length > 0) {
    for (const piece of text.split(',')) {
      const slot = asInt(piece.trim());
      if (slot === 1 || slot === 2) {
        result.add(slot);
      }
    }
  }
  if (result.size === 0) {
    result.add(1);
  }
  return result;
}

function parseHostAllowlist(raw: string | undefined): Set<string> {
  const result = new Set<string>();
  const text = (raw || '').trim();
  if (!text) return result;

  for (const host of text.split(',')) {
    const normalized = host.trim().toLowerCase();
    if (!normalized) continue;
    result.add(normalized);
  }
  return result;
}

function normalizeSignature(signature: string | null): string | null {
  const raw = asString(signature);
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(/^sha256=/, '').trim();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return null;
  return normalized;
}

function constantTimeCompareHex(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

function pruneReplayCache(nowSeconds: number): void {
  for (const [key, expiresAt] of replayCache.entries()) {
    if (expiresAt <= nowSeconds) {
      replayCache.delete(key);
    }
  }
}

function getClientFingerprint(req: Request): string {
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const ip = forwardedFor.split(',')[0]?.trim();
    if (ip) return ip;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) {
    const trimmed = realIp.trim();
    if (trimmed) return trimmed;
  }
  return 'local';
}

function checkRateLimit(req: Request, token: string, limitPerMinute: number): { ok: boolean; retryAfter: number } {
  const minute = Math.floor(Date.now() / 60_000);
  if (rateBuckets.size > 2048) {
    for (const [key, bucket] of rateBuckets.entries()) {
      if (bucket.minute < minute - 2) {
        rateBuckets.delete(key);
      }
    }
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const key = `${getClientFingerprint(req)}:${tokenHash}`;
  const existing = rateBuckets.get(key);

  if (!existing || existing.minute !== minute) {
    rateBuckets.set(key, { minute, count: 1 });
    return { ok: true, retryAfter: 0 };
  }

  if (existing.count >= limitPerMinute) {
    const elapsed = Math.floor((Date.now() % 60_000) / 1000);
    return { ok: false, retryAfter: Math.max(1, 60 - elapsed) };
  }

  existing.count += 1;
  rateBuckets.set(key, existing);
  return { ok: true, retryAfter: 0 };
}

function verifySignedRequest(
  req: Request,
  rawBody: string,
  signingSecret: string,
  maxClockSkewSeconds: number,
): { ok: boolean; error?: string } {
  const rawTimestamp = asString(req.headers.get('x-openclaw-timestamp'));
  const signature = normalizeSignature(req.headers.get('x-openclaw-signature'));

  if (!rawTimestamp || !signature) {
    return { ok: false, error: 'Missing or invalid request signature headers.' };
  }

  let parsedTimestamp = Number.parseInt(rawTimestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return { ok: false, error: 'Invalid request timestamp.' };
  }
  if (parsedTimestamp > 1_000_000_000_000) {
    parsedTimestamp = Math.floor(parsedTimestamp / 1000);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - parsedTimestamp) > maxClockSkewSeconds) {
    return { ok: false, error: 'Request timestamp is outside allowed clock skew.' };
  }

  const expectedSignature = crypto
    .createHmac('sha256', signingSecret)
    .update(`${parsedTimestamp}.${rawBody}`)
    .digest('hex');

  if (!constantTimeCompareHex(expectedSignature, signature)) {
    return { ok: false, error: 'Invalid request signature.' };
  }

  pruneReplayCache(nowSeconds);
  const replayKey = `${parsedTimestamp}:${signature}`;
  if (replayCache.has(replayKey)) {
    return { ok: false, error: 'Replay detected for signed request.' };
  }
  replayCache.set(replayKey, nowSeconds + maxClockSkewSeconds);

  return { ok: true };
}

function isHostAllowlisted(hostname: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true;
  for (const allowed of allowlist) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
      return true;
    }
  }
  return false;
}

function validateRemoteMediaUrl(url: URL, allowlist: Set<string>): void {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Media URL must use http or https.');
  }

  if (url.username || url.password) {
    throw new Error('Media URL credentials are not allowed.');
  }

  const host = url.hostname.toLowerCase();
  if (isPrivateHostname(host)) {
    throw new Error('Private/local media URLs are not allowed.');
  }

  if (!isHostAllowlisted(host, allowlist)) {
    throw new Error(`Media host "${host}" is not allowed.`);
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveText(body: BridgePostBody): string | null {
  return (
    asString(body.text) ||
    asString(body.tweet_text) ||
    asString(body.tweet) ||
    asString(body.content) ||
    asString(body.message) ||
    asString(body.body)
  );
}

function resolveCommunityId(body: BridgePostBody): string | undefined {
  return asString(body.community_id) || asString(body.communityId) || undefined;
}

function resolveReplyToTweetId(body: BridgePostBody): string | undefined {
  return (
    asString(body.reply_to_tweet_id) ||
    asString(body.replyToTweetId) ||
    asString(body.reply_to) ||
    asString(body.replyTo) ||
    undefined
  );
}

async function resolveAccountSlot(body: BridgePostBody): Promise<number> {
  const rawSlotCandidates: unknown[] = [body.account_slot, body.accountSlot, body.slot];
  const rawSlotValue = rawSlotCandidates.find((value) => isProvided(value));

  if (isProvided(rawSlotValue)) {
    const parsed = asInt(rawSlotValue);
    if (parsed === 1 || parsed === 2) return parsed;
    throw new Error('Invalid account slot. Use 1 or 2.');
  }

  const accountHintRaw =
    asString(body.account) ||
    asString(body.account_handle) ||
    asString(body.accountHandle) ||
    asString(body.username) ||
    asString(body.handle);

  if (accountHintRaw) {
    const accountHint = normalizeHandle(accountHintRaw);

    if (accountHint === '1' || accountHint === '2') {
      return Number(accountHint);
    }

    const rows = await db
      .select({
        slot: xAccounts.slot,
        username: xAccounts.twitterUsername,
      })
      .from(xAccounts);

    const matched = rows.find((row) => normalizeHandle(row.username || '') === accountHint);
    if (matched?.slot === 1 || matched?.slot === 2) {
      return matched.slot;
    }
    throw new Error(`Unknown account handle "${accountHintRaw}".`);
  }

  // Default bridge target is slot 1 (swarm_signal in your current setup).
  return 1;
}

function constantTimeTokenMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getIncomingBridgeToken(req: Request): string | null {
  const authHeader = req.headers.get('authorization');
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return asString(req.headers.get('x-openclaw-token'));
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower.endsWith('.local')) return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true;
  if (/^169\.254\./.test(lower)) return true;
  return false;
}

async function readLocalUploadMedia(mediaPath: string): Promise<Buffer> {
  const normalized = mediaPath.startsWith('/') ? mediaPath.slice(1) : mediaPath;
  if (!normalized.startsWith('uploads/')) {
    throw new Error('Local media path must start with /uploads/.');
  }

  const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads');
  const resolvedPath = path.resolve(process.cwd(), 'public', normalized);
  if (!resolvedPath.startsWith(`${uploadsRoot}${path.sep}`)) {
    throw new Error('Invalid local media path.');
  }

  const buffer = await fs.readFile(resolvedPath);
  if (buffer.length <= 0 || buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('Local media is empty or too large.');
  }
  return buffer;
}

async function fetchRemoteMedia(mediaUrl: string): Promise<Buffer> {
  let current: URL;
  try {
    current = new URL(mediaUrl);
  } catch {
    throw new Error('Invalid media URL.');
  }

  const mediaHostAllowlist = parseHostAllowlist(process.env.OPENCLAW_BRIDGE_MEDIA_HOST_ALLOWLIST);
  const timeoutMs = clamp(
    asInt(process.env.OPENCLAW_BRIDGE_MEDIA_FETCH_TIMEOUT_MS) || DEFAULT_MEDIA_FETCH_TIMEOUT_MS,
    1000,
    60_000,
  );

  for (let hop = 0; hop < 5; hop += 1) {
    validateRemoteMediaUrl(current, mediaHostAllowlist);

    const response = await fetch(current.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'image/*',
        'User-Agent': 'x-manager/0.1 (+openclaw-bridge)',
      },
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error('Media redirect response missing location header.');
      }
      current = new URL(location, current);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch media (${response.status}).`);
    }

    const contentLength = asInt(response.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_MEDIA_BYTES) {
      throw new Error('Remote media exceeds maximum allowed size.');
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error('Remote media must be an image.');
    }
    if (contentType.includes('svg')) {
      throw new Error('SVG media is not supported.');
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength <= 0 || arrayBuffer.byteLength > MAX_MEDIA_BYTES) {
      throw new Error('Remote media is empty or too large.');
    }

    return Buffer.from(arrayBuffer);
  }

  throw new Error('Too many redirects when fetching media.');
}

async function resolveMediaBuffers(mediaUrls: string[]): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const mediaUrl of mediaUrls) {
    if (mediaUrl.startsWith('/uploads/') || mediaUrl.startsWith('uploads/')) {
      buffers.push(await readLocalUploadMedia(mediaUrl));
    } else {
      buffers.push(await fetchRemoteMedia(mediaUrl));
    }
  }
  return buffers;
}

export async function POST(req: Request) {
  try {
    const configuredToken = asString(process.env.OPENCLAW_BRIDGE_TOKEN);
    if (!configuredToken) {
      return noStoreJson(
        {
          error: 'Bridge token is not configured. Set OPENCLAW_BRIDGE_TOKEN and restart x-manager.',
        },
        503,
      );
    }

    const providedToken = getIncomingBridgeToken(req);
    if (!providedToken || !constantTimeTokenMatch(configuredToken, providedToken)) {
      return noStoreJson({ error: 'Unauthorized bridge request.' }, 401);
    }

    const rateLimitPerMinute = clamp(
      asInt(process.env.OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN) || DEFAULT_RATE_LIMIT_PER_MIN,
      1,
      600,
    );
    const rate = checkRateLimit(req, configuredToken, rateLimitPerMinute);
    if (!rate.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for bridge requests.' },
        {
          status: 429,
          headers: {
            'Cache-Control': 'no-store',
            'Retry-After': String(rate.retryAfter),
          },
        },
      );
    }

    const contentLength = asInt(req.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
      return noStoreJson({ error: 'Request body too large.' }, 413);
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return noStoreJson({ error: 'Request body too large.' }, 413);
    }

    const signingSecret = asString(process.env.OPENCLAW_BRIDGE_SIGNING_SECRET);
    const requireSignature = asBool(process.env.OPENCLAW_BRIDGE_REQUIRE_SIGNATURE, Boolean(signingSecret));
    if (requireSignature) {
      if (!signingSecret) {
        return noStoreJson({ error: 'Bridge signing secret is required but not configured.' }, 503);
      }
      const maxClockSkewSeconds = clamp(
        asInt(process.env.OPENCLAW_BRIDGE_MAX_CLOCK_SKEW_SECONDS) || DEFAULT_MAX_CLOCK_SKEW_SECONDS,
        30,
        3600,
      );
      const verification = verifySignedRequest(req, rawBody, signingSecret, maxClockSkewSeconds);
      if (!verification.ok) {
        return noStoreJson({ error: verification.error || 'Invalid request signature.' }, 401);
      }
    }

    let body: BridgePostBody = {};
    try {
      body = (rawBody ? JSON.parse(rawBody) : {}) as BridgePostBody;
    } catch {
      return noStoreJson({ error: 'Invalid JSON request body.' }, 400);
    }

    const text = resolveText(body);
    if (!text) {
      return noStoreJson(
        { error: 'Missing text. Provide text/content/message/tweet_text.' },
        400,
      );
    }
    if (text.length > MAX_TWEET_CHARS) {
      return noStoreJson({ error: `Tweet text exceeds ${MAX_TWEET_CHARS} characters.` }, 400);
    }

    let accountSlot = 1;
    try {
      accountSlot = await resolveAccountSlot(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid account selector.';
      return noStoreJson({ error: message }, 400);
    }

    const allowedSlots = parseAllowedSlots(process.env.OPENCLAW_BRIDGE_ALLOWED_SLOTS);
    if (!allowedSlots.has(accountSlot)) {
      return noStoreJson({ error: 'Account slot is not allowed for bridge posting.' }, 403);
    }

    const communityId = resolveCommunityId(body);
    const replyToTweetId = resolveReplyToTweetId(body);
    const dryRun = asBool(body.dry_run ?? body.dryRun ?? body.simulate, false);

    const mediaUrlValues = uniqueStrings([
      ...parseMediaList(body.media_urls),
      ...parseMediaList(body.mediaUrls),
      ...parseMediaList(body.media_url),
      ...parseMediaList(body.mediaUrl),
      ...parseMediaList(body.image_urls),
      ...parseMediaList(body.imageUrls),
      ...parseMediaList(body.image_url),
      ...parseMediaList(body.imageUrl),
      ...parseMediaList(body.images),
      ...parseMediaList(body.files),
    ]);
    if (mediaUrlValues.length > MAX_MEDIA_ITEMS) {
      return noStoreJson(
        { error: `Too many media URLs. Maximum ${MAX_MEDIA_ITEMS} attachments are supported.` },
        400,
      );
    }
    const mediaUrls = mediaUrlValues.slice(0, MAX_MEDIA_ITEMS);

    const accountRows = await db
      .select()
      .from(xAccounts)
      .where(eq(xAccounts.slot, accountSlot))
      .limit(1);
    const account = accountRows[0] ? decryptAccountTokens(accountRows[0]) : null;

    if (!account?.twitterAccessToken || !account?.twitterAccessTokenSecret) {
      return noStoreJson(
        { error: `Account slot ${accountSlot} is not connected.` },
        400,
      );
    }

    if (dryRun) {
      return noStoreJson({
        ok: true,
        dry_run: true,
        post: {
          account_slot: accountSlot,
          account_hint: asString(body.account) || asString(body.handle) || asString(body.username) || null,
          text,
          media_urls: mediaUrls,
          community_id: communityId || null,
          reply_to_tweet_id: replyToTweetId || null,
        },
      });
    }

    const config = await getResolvedXConfig();
    let mediaBuffers: Buffer[] = [];
      try {
        mediaBuffers = await resolveMediaBuffers(mediaUrls);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid media URL.';
        return noStoreJson({ error: message }, 400);
      }
    const mediaIds: string[] = [];

    for (let index = 0; index < mediaBuffers.length; index += 1) {
      const uploadResult = await uploadMedia(
        mediaBuffers[index],
        account.twitterAccessToken,
        account.twitterAccessTokenSecret,
        config,
      );
      if (!uploadResult?.media_id_string) {
        return noStoreJson(
          { error: `Failed to upload media at index ${index}.` },
          502,
        );
      }
      mediaIds.push(uploadResult.media_id_string);
    }

    const postResult = await postTweet(
      text,
      account.twitterAccessToken,
      account.twitterAccessTokenSecret,
      mediaIds,
      communityId,
      replyToTweetId,
      config,
    );

    if (postResult.errors && postResult.errors.length > 0) {
      return noStoreJson(
        {
          error: 'X API rejected bridge post.',
          details: postResult.errors.map((entry) => entry.message),
        },
        502,
      );
    }

    if (!postResult.data?.id) {
      return noStoreJson(
        { error: 'X API returned an unexpected response for bridge post.' },
        502,
      );
    }

    return noStoreJson({
      ok: true,
      account_slot: accountSlot,
      tweet_id: postResult.data.id,
      text: postResult.data.text || text,
    });
  } catch (error) {
    console.error('Error posting via OpenClaw bridge:', error);
    return noStoreJson({ error: 'Failed to post via bridge.' }, 500);
  }
}
