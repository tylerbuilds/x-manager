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
import { apiError } from '@/lib/api-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const MAX_BATCH_SIZE = 10;
const MAX_MEDIA_ITEMS = 4;
const MAX_MEDIA_BYTES = 8_000_000;
const MAX_TWEET_CHARS = 280;
const MAX_BODY_BYTES = 500_000; // Larger than single post to accommodate batch payloads
const DEFAULT_MEDIA_FETCH_TIMEOUT_MS = 12_000;
const DEFAULT_RATE_LIMIT_PER_MIN = 20;
const DEFAULT_MAX_CLOCK_SKEW_SECONDS = 300;

/* ------------------------------------------------------------------ */
/*  In-memory rate limiting & replay protection                       */
/* ------------------------------------------------------------------ */

type RateBucket = {
  minute: number;
  count: number;
};

const replayCache = new Map<string, number>();
const rateBuckets = new Map<string, RateBucket>();

/* ------------------------------------------------------------------ */
/*  Tiny helpers (duplicated from single-post route; not exported)    */
/* ------------------------------------------------------------------ */

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
    headers: { 'Cache-Control': 'no-store' },
  });
}

/* ------------------------------------------------------------------ */
/*  Media helpers                                                     */
/* ------------------------------------------------------------------ */

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

function parseHostAllowlist(raw: string | undefined): Set<string> {
  const result = new Set<string>();
  const text = (raw || '').trim();
  if (!text) return result;
  for (const host of text.split(',')) {
    const normalized = host.trim().toLowerCase();
    if (normalized) result.add(normalized);
  }
  return result;
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

function isHostAllowlisted(hostname: string, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true;
  for (const allowed of allowlist) {
    if (hostname === allowed || hostname.endsWith(`.${allowed}`)) return true;
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
      if (!location) throw new Error('Media redirect response missing location header.');
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

/* ------------------------------------------------------------------ */
/*  Auth & security helpers                                           */
/* ------------------------------------------------------------------ */

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
    if (match?.[1]) return match[1].trim();
  }
  return asString(req.headers.get('x-openclaw-token'));
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
    if (expiresAt <= nowSeconds) replayCache.delete(key);
  }
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

/* ------------------------------------------------------------------ */
/*  Rate limiting (shared key format with single-post bridge)         */
/* ------------------------------------------------------------------ */

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

function checkRateLimit(
  req: Request,
  token: string,
  limitPerMinute: number,
  postsInBatch: number,
): { ok: boolean; retryAfter: number } {
  const minute = Math.floor(Date.now() / 60_000);

  // Prune old buckets if the map is getting large
  if (rateBuckets.size > 2048) {
    for (const [key, bucket] of rateBuckets.entries()) {
      if (bucket.minute < minute - 2) rateBuckets.delete(key);
    }
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 12);
  const key = `${getClientFingerprint(req)}:${tokenHash}`;
  const existing = rateBuckets.get(key);

  if (!existing || existing.minute !== minute) {
    rateBuckets.set(key, { minute, count: postsInBatch });
    return { ok: true, retryAfter: 0 };
  }

  if (existing.count + postsInBatch > limitPerMinute) {
    const elapsed = Math.floor((Date.now() % 60_000) / 1000);
    return { ok: false, retryAfter: Math.max(1, 60 - elapsed) };
  }

  existing.count += postsInBatch;
  rateBuckets.set(key, existing);
  return { ok: true, retryAfter: 0 };
}

/* ------------------------------------------------------------------ */
/*  Account / slot resolution                                         */
/* ------------------------------------------------------------------ */

function parseAllowedSlots(raw: string | undefined): Set<number> {
  const result = new Set<number>();
  const text = (raw || '').trim();
  if (text.length > 0) {
    for (const piece of text.split(',')) {
      const slot = asInt(piece.trim());
      if (slot === 1 || slot === 2) result.add(slot);
    }
  }
  if (result.size === 0) result.add(1);
  return result;
}

async function resolveAccountSlot(post: Record<string, unknown>): Promise<number> {
  const rawSlotCandidates: unknown[] = [post.account_slot, post.accountSlot, post.slot];
  const rawSlotValue = rawSlotCandidates.find((value) => isProvided(value));

  if (isProvided(rawSlotValue)) {
    const parsed = asInt(rawSlotValue);
    if (parsed === 1 || parsed === 2) return parsed;
    throw new Error('Invalid account slot. Use 1 or 2.');
  }

  const accountHintRaw =
    asString(post.account) ||
    asString(post.account_handle) ||
    asString(post.accountHandle) ||
    asString(post.username) ||
    asString(post.handle);

  if (accountHintRaw) {
    const accountHint = normalizeHandle(accountHintRaw);

    if (accountHint === '1' || accountHint === '2') {
      return Number(accountHint);
    }

    const rows = await db
      .select({ slot: xAccounts.slot, username: xAccounts.twitterUsername })
      .from(xAccounts);

    const matched = rows.find((row) => normalizeHandle(row.username || '') === accountHint);
    if (matched?.slot === 1 || matched?.slot === 2) return matched.slot;
    throw new Error(`Unknown account handle "${accountHintRaw}".`);
  }

  return 1;
}

/* ------------------------------------------------------------------ */
/*  Per-post field resolution                                         */
/* ------------------------------------------------------------------ */

function resolveText(post: Record<string, unknown>): string | null {
  return (
    asString(post.text) ||
    asString(post.tweet_text) ||
    asString(post.tweet) ||
    asString(post.content) ||
    asString(post.message) ||
    asString(post.body)
  );
}

function resolveCommunityId(post: Record<string, unknown>): string | undefined {
  return asString(post.community_id) || asString(post.communityId) || undefined;
}

function resolveReplyToTweetId(post: Record<string, unknown>): string | undefined {
  return (
    asString(post.reply_to_tweet_id) ||
    asString(post.replyToTweetId) ||
    asString(post.reply_to) ||
    asString(post.replyTo) ||
    undefined
  );
}

function resolveMediaUrls(post: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...parseMediaList(post.media_urls),
    ...parseMediaList(post.mediaUrls),
    ...parseMediaList(post.media_url),
    ...parseMediaList(post.mediaUrl),
    ...parseMediaList(post.image_urls),
    ...parseMediaList(post.imageUrls),
    ...parseMediaList(post.image_url),
    ...parseMediaList(post.imageUrl),
    ...parseMediaList(post.images),
    ...parseMediaList(post.files),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Result types                                                      */
/* ------------------------------------------------------------------ */

type BatchItemResult = {
  index: number;
  ok: boolean;
  tweet_id?: string;
  text?: string;
  account_slot?: number;
  dry_run?: boolean;
  error?: string;
  code?: string;
};

/* ------------------------------------------------------------------ */
/*  POST handler                                                      */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  try {
    /* ---- Auth ---- */

    const configuredToken = asString(process.env.OPENCLAW_BRIDGE_TOKEN);
    if (!configuredToken) {
      return apiError(
        'BRIDGE_NOT_CONFIGURED',
        'Bridge token is not configured. Set OPENCLAW_BRIDGE_TOKEN and restart x-manager.',
      );
    }

    const providedToken = getIncomingBridgeToken(req);
    if (!providedToken || !constantTimeTokenMatch(configuredToken, providedToken)) {
      return apiError('UNAUTHORIZED', 'Unauthorized bridge request.');
    }

    /* ---- Body size guard ---- */

    const contentLength = asInt(req.headers.get('content-length'));
    if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
      return apiError('VALIDATION_ERROR', 'Request body too large.', { status: 413 });
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return apiError('VALIDATION_ERROR', 'Request body too large.', { status: 413 });
    }

    /* ---- Signature verification ---- */

    const signingSecret = asString(process.env.OPENCLAW_BRIDGE_SIGNING_SECRET);
    const requireSignature = asBool(process.env.OPENCLAW_BRIDGE_REQUIRE_SIGNATURE, Boolean(signingSecret));
    if (requireSignature) {
      if (!signingSecret) {
        return apiError(
          'BRIDGE_NOT_CONFIGURED',
          'Bridge signing secret is required but not configured.',
        );
      }
      const maxClockSkewSeconds = clamp(
        asInt(process.env.OPENCLAW_BRIDGE_MAX_CLOCK_SKEW_SECONDS) || DEFAULT_MAX_CLOCK_SKEW_SECONDS,
        30,
        3600,
      );
      const verification = verifySignedRequest(req, rawBody, signingSecret, maxClockSkewSeconds);
      if (!verification.ok) {
        return apiError('UNAUTHORIZED', verification.error || 'Invalid request signature.');
      }
    }

    /* ---- Parse body ---- */

    let body: Record<string, unknown>;
    try {
      body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
    } catch {
      return apiError('VALIDATION_ERROR', 'Invalid JSON request body.');
    }

    const posts = body.posts;
    if (!Array.isArray(posts)) {
      return apiError('VALIDATION_ERROR', 'Missing or invalid "posts" array in request body.');
    }

    if (posts.length === 0) {
      return apiError('VALIDATION_ERROR', 'The "posts" array must not be empty.');
    }

    if (posts.length > MAX_BATCH_SIZE) {
      return apiError(
        'VALIDATION_ERROR',
        `Batch size ${posts.length} exceeds maximum of ${MAX_BATCH_SIZE}.`,
      );
    }

    const globalDryRun = asBool(body.dryRun ?? body.dry_run ?? body.simulate, false);

    /* ---- Rate limiting (charge full batch count upfront) ---- */

    const rateLimitPerMinute = clamp(
      asInt(process.env.OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN) || DEFAULT_RATE_LIMIT_PER_MIN,
      1,
      600,
    );
    const rate = checkRateLimit(req, configuredToken, rateLimitPerMinute, posts.length);
    if (!rate.ok) {
      return apiError('RATE_LIMIT_EXCEEDED', 'Rate limit exceeded for bridge requests.', {
        retryAfter: rate.retryAfter,
      });
    }

    /* ---- Pre-resolve shared config & allowed slots ---- */

    const allowedSlots = parseAllowedSlots(process.env.OPENCLAW_BRIDGE_ALLOWED_SLOTS);
    const config = globalDryRun ? null : await getResolvedXConfig();

    // Cache resolved accounts so we don't decrypt for every post in the batch.
    const accountCache = new Map<
      number,
      { twitterAccessToken: string; twitterAccessTokenSecret: string } | null
    >();

    async function getAccount(slot: number) {
      if (accountCache.has(slot)) return accountCache.get(slot)!;

      const rows = await db
        .select()
        .from(xAccounts)
        .where(eq(xAccounts.slot, slot))
        .limit(1);

      const raw = rows[0] ? decryptAccountTokens(rows[0]) : null;
      const result =
        raw?.twitterAccessToken && raw?.twitterAccessTokenSecret
          ? { twitterAccessToken: raw.twitterAccessToken, twitterAccessTokenSecret: raw.twitterAccessTokenSecret }
          : null;

      accountCache.set(slot, result);
      return result;
    }

    /* ---- Process posts sequentially ---- */

    const results: BatchItemResult[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];

      // Each post must be an object.
      if (!post || typeof post !== 'object' || Array.isArray(post)) {
        results.push({ index: i, ok: false, error: 'Post entry must be a JSON object.', code: 'VALIDATION_ERROR' });
        failed++;
        continue;
      }

      const postObj = post as Record<string, unknown>;

      try {
        /* -- Resolve account slot -- */
        const accountSlot = await resolveAccountSlot(postObj);

        if (!allowedSlots.has(accountSlot)) {
          results.push({
            index: i,
            ok: false,
            error: 'Account slot is not allowed for bridge posting.',
            code: 'POLICY_REJECTED',
          });
          failed++;
          continue;
        }

        /* -- Validate text -- */
        const text = resolveText(postObj);
        if (!text) {
          results.push({
            index: i,
            ok: false,
            error: 'Missing text. Provide text/content/message/tweet_text.',
            code: 'VALIDATION_ERROR',
          });
          failed++;
          continue;
        }

        if (text.length > MAX_TWEET_CHARS) {
          results.push({
            index: i,
            ok: false,
            error: `Tweet text exceeds ${MAX_TWEET_CHARS} characters.`,
            code: 'VALIDATION_ERROR',
          });
          failed++;
          continue;
        }

        /* -- Optional fields -- */
        const communityId = resolveCommunityId(postObj);
        const replyToTweetId = resolveReplyToTweetId(postObj);
        const itemDryRun =
          globalDryRun || asBool(postObj.dry_run ?? postObj.dryRun ?? postObj.simulate, false);

        /* -- Validate media -- */
        const mediaUrls = resolveMediaUrls(postObj);
        if (mediaUrls.length > MAX_MEDIA_ITEMS) {
          results.push({
            index: i,
            ok: false,
            error: `Too many media URLs. Maximum ${MAX_MEDIA_ITEMS} attachments are supported.`,
            code: 'VALIDATION_ERROR',
          });
          failed++;
          continue;
        }

        /* -- Dry run shortcut -- */
        if (itemDryRun) {
          results.push({
            index: i,
            ok: true,
            dry_run: true,
            account_slot: accountSlot,
            text,
          });
          succeeded++;
          continue;
        }

        /* -- Resolve account from DB -- */
        const account = await getAccount(accountSlot);
        if (!account) {
          results.push({
            index: i,
            ok: false,
            error: `Account slot ${accountSlot} is not connected.`,
            code: 'ACCOUNT_NOT_CONNECTED',
          });
          failed++;
          continue;
        }

        /* -- Fetch & upload media -- */
        let mediaBuffers: Buffer[] = [];
        try {
          mediaBuffers = await resolveMediaBuffers(mediaUrls);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid media URL.';
          results.push({ index: i, ok: false, error: message, code: 'MEDIA_UPLOAD_FAILED' });
          failed++;
          continue;
        }

        const mediaIds: string[] = [];
        let mediaFailed = false;
        for (let mi = 0; mi < mediaBuffers.length; mi++) {
          const uploadResult = await uploadMedia(
            mediaBuffers[mi],
            account.twitterAccessToken,
            account.twitterAccessTokenSecret,
            config!,
          );
          if (!uploadResult?.media_id_string) {
            results.push({
              index: i,
              ok: false,
              error: `Failed to upload media at index ${mi}.`,
              code: 'MEDIA_UPLOAD_FAILED',
            });
            failed++;
            mediaFailed = true;
            break;
          }
          mediaIds.push(uploadResult.media_id_string);
        }
        if (mediaFailed) continue;

        /* -- Post tweet -- */
        const postResult = await postTweet(
          text,
          account.twitterAccessToken,
          account.twitterAccessTokenSecret,
          mediaIds,
          communityId,
          replyToTweetId,
          config!,
        );

        if (postResult.errors && postResult.errors.length > 0) {
          const errMsg = postResult.errors.map((e) => e.message).join(' ');
          results.push({ index: i, ok: false, error: errMsg, code: 'X_API_ERROR' });
          failed++;
          continue;
        }

        if (!postResult.data?.id) {
          results.push({
            index: i,
            ok: false,
            error: 'X API returned an unexpected response.',
            code: 'X_API_ERROR',
          });
          failed++;
          continue;
        }

        results.push({
          index: i,
          ok: true,
          tweet_id: postResult.data.id,
          text: postResult.data.text || text,
          account_slot: accountSlot,
        });
        succeeded++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unexpected error processing post.';
        results.push({ index: i, ok: false, error: message, code: 'INTERNAL_ERROR' });
        failed++;
      }
    }

    return noStoreJson({
      ok: failed === 0,
      results,
      summary: {
        total: posts.length,
        succeeded,
        failed,
      },
    });
  } catch (error) {
    console.error('Error in batch bridge endpoint:', error);
    return apiError('INTERNAL_ERROR', 'Failed to process batch bridge request.');
  }
}
