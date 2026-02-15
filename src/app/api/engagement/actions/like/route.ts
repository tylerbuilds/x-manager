import { NextResponse } from 'next/server';
import { likeTweet } from '@/lib/twitter-api-client';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from '@/lib/engagement-ops';

type LikeBody = {
  account_slot?: unknown;
  tweet_id?: unknown;
  inbox_id?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  let accountSlot: 1 | 2 = 1;
  let inboxId: number | null = null;
  let tweetId: string | null = null;

  try {
    const body = (await req.json()) as LikeBody;
    accountSlot = parseAccountSlot(body.account_slot ?? 1);
    inboxId = asInt(body.inbox_id);
    tweetId = asString(body.tweet_id);

    if (!tweetId) {
      return NextResponse.json({ error: 'tweet_id is required.' }, { status: 400 });
    }

    const account = await requireConnectedAccount(accountSlot);
    if (!account.twitterUserId) {
      return NextResponse.json({ error: 'Connected account is missing twitter user id.' }, { status: 400 });
    }

    await likeTweet(
      account.twitterAccessToken,
      account.twitterAccessTokenSecret,
      account.twitterUserId,
      tweetId,
    );

    await recordEngagementAction({
      inboxId,
      accountSlot,
      actionType: 'like',
      targetId: tweetId,
      payload: {},
      status: 'success',
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to like tweet.';
    await recordEngagementAction({
      inboxId,
      accountSlot,
      actionType: 'like',
      targetId: tweetId,
      payload: {},
      status: 'failed',
      errorMessage: message,
    }).catch(() => {
      // Ignore follow-up logging failures.
    });

    console.error('Failed to like tweet:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
