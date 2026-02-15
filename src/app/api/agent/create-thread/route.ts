import { NextResponse } from 'next/server';
import { normalizeAccountSlot } from '@/lib/account-slots';
import { getResolvedXConfig } from '@/lib/x-config';
import {
  buildThreadDraft,
  downloadRemoteImages,
  fetchAndExtractArticle,
} from '@/lib/create-thread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateThreadRequest = {
  article_url?: unknown;
  articleUrl?: unknown;
  account_slot?: unknown;
  accountSlot?: unknown;
  scheduled_time?: unknown;
  scheduledTime?: unknown;
  schedule?: unknown;
  dedupe?: unknown;
  include_images?: unknown;
  includeImages?: unknown;
  max_tweets?: unknown;
  maxTweets?: unknown;
  community_id?: unknown;
  communityId?: unknown;
  reply_to_tweet_id?: unknown;
  replyToTweetId?: unknown;
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

function asInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower === '::1' || lower.endsWith('.local')) return true;
  if (/^127\./.test(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true;
  return false;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CreateThreadRequest;
    const rawArticleUrl = asString(body.article_url ?? body.articleUrl);
    if (!rawArticleUrl) {
      return NextResponse.json({ error: 'Missing article_url.' }, { status: 400 });
    }

    let articleUrl: string;
    try {
      const parsed = new URL(rawArticleUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json({ error: 'article_url must use http or https.' }, { status: 400 });
      }
      if (isPrivateHostname(parsed.hostname)) {
        return NextResponse.json({ error: 'Private/local network URLs are not allowed.' }, { status: 400 });
      }
      articleUrl = parsed.toString();
    } catch {
      return NextResponse.json({ error: 'Invalid article_url.' }, { status: 400 });
    }

    const accountSlot = normalizeAccountSlot(body.account_slot ?? body.accountSlot, 1);
    const maxTweets = Math.max(2, Math.min(12, asInt(body.max_tweets ?? body.maxTweets, 6)));
    const includeImages = asBool(body.include_images ?? body.includeImages, true);
    const schedule = asBool(body.schedule, false);
    const dedupe = asBool(body.dedupe, true);

    const article = await fetchAndExtractArticle(articleUrl);
    const downloadedMediaUrls = includeImages
      ? await downloadRemoteImages(article.imageUrls, Math.max(0, maxTweets - 1))
      : [];

    const draft = buildThreadDraft(article, downloadedMediaUrls, maxTweets);

    const baseResponse = {
      ok: true,
      article: {
        url: article.url,
        canonical_url: article.canonicalUrl,
        title: article.title,
        description: article.description,
        quote_candidates: article.quoteCandidates,
        article_image_urls: article.imageUrls,
        downloaded_media_urls: downloadedMediaUrls,
        excerpt: article.excerpt,
      },
      draft: {
        account_slot: accountSlot,
        source_url: draft.source_url,
        tweets: draft.tweets,
      },
    };

    if (!schedule) {
      return NextResponse.json({
        ...baseResponse,
        scheduled: false,
      });
    }

    const scheduledTime = asString(body.scheduled_time ?? body.scheduledTime);
    if (!scheduledTime) {
      return NextResponse.json({ error: 'Missing scheduled_time when schedule=true.' }, { status: 400 });
    }

    const parsedScheduled = new Date(scheduledTime);
    if (Number.isNaN(parsedScheduled.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled_time. Provide an ISO date string.' }, { status: 400 });
    }

    const config = await getResolvedXConfig();
    const schedulerResponse = await fetch(`${config.appBaseUrl}/api/scheduler/thread`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_slot: accountSlot,
        scheduled_time: parsedScheduled.toISOString(),
        dedupe,
        community_id: asString(body.community_id ?? body.communityId) || undefined,
        reply_to_tweet_id: asString(body.reply_to_tweet_id ?? body.replyToTweetId) || undefined,
        source_url: draft.source_url,
        tweets: draft.tweets,
      }),
    });

    const schedulerJson = await schedulerResponse.json().catch(() => ({ error: 'Invalid scheduler response.' }));
    if (!schedulerResponse.ok) {
      return NextResponse.json(
        {
          error: 'Failed to schedule generated thread.',
          details: schedulerJson,
          ...baseResponse,
          scheduled: false,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      ...baseResponse,
      scheduled: true,
      schedule_result: schedulerJson,
    });
  } catch (error) {
    console.error('Error creating thread from article:', error);
    const message = error instanceof Error ? error.message : 'Failed to create thread.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
