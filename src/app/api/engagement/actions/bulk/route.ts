import { NextResponse } from 'next/server';
import { likeTweet, repostTweet, postTweet } from '@/lib/twitter-api-client';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from '@/lib/engagement-ops';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITEMS = 25;

type BulkAction = {
  action: 'like' | 'repost' | 'reply' | 'dismiss';
  inbox_id?: number;
  tweet_id?: string;
  text?: string;
  account_slot?: unknown;
};

type BulkResult = {
  index: number;
  action: string;
  status: 'ok' | 'error';
  error?: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const items = body.items as BulkAction[] | undefined;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items array is required.' }, { status: 400 });
    }

    if (items.length > MAX_ITEMS) {
      return NextResponse.json(
        { error: `Too many items. Maximum ${MAX_ITEMS} per request.` },
        { status: 400 },
      );
    }

    const results: BulkResult[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const accountSlot = parseAccountSlot(item.account_slot ?? 1);
        const account = await requireConnectedAccount(accountSlot);

        if (!account.twitterUserId) {
          results.push({ index: i, action: item.action, status: 'error', error: 'Missing twitter user ID.' });
          continue;
        }

        switch (item.action) {
          case 'like': {
            if (!item.tweet_id) {
              results.push({ index: i, action: 'like', status: 'error', error: 'tweet_id required.' });
              break;
            }
            await likeTweet(account.twitterAccessToken, account.twitterAccessTokenSecret, account.twitterUserId, item.tweet_id);
            await recordEngagementAction({
              inboxId: item.inbox_id ?? null,
              accountSlot,
              actionType: 'like',
              targetId: item.tweet_id,
              payload: {},
              status: 'success',
            });
            results.push({ index: i, action: 'like', status: 'ok' });
            break;
          }

          case 'repost': {
            if (!item.tweet_id) {
              results.push({ index: i, action: 'repost', status: 'error', error: 'tweet_id required.' });
              break;
            }
            await repostTweet(account.twitterAccessToken, account.twitterAccessTokenSecret, account.twitterUserId, item.tweet_id);
            await recordEngagementAction({
              inboxId: item.inbox_id ?? null,
              accountSlot,
              actionType: 'repost',
              targetId: item.tweet_id,
              payload: {},
              status: 'success',
            });
            results.push({ index: i, action: 'repost', status: 'ok' });
            break;
          }

          case 'reply': {
            if (!item.tweet_id || !item.text?.trim()) {
              results.push({ index: i, action: 'reply', status: 'error', error: 'tweet_id and text required.' });
              break;
            }
            await postTweet(item.text, account.twitterAccessToken, account.twitterAccessTokenSecret, [], undefined, item.tweet_id);
            await recordEngagementAction({
              inboxId: item.inbox_id ?? null,
              accountSlot,
              actionType: 'reply',
              targetId: item.tweet_id,
              payload: { text: item.text },
              status: 'success',
            });
            results.push({ index: i, action: 'reply', status: 'ok' });
            break;
          }

          case 'dismiss': {
            if (!item.inbox_id) {
              results.push({ index: i, action: 'dismiss', status: 'error', error: 'inbox_id required.' });
              break;
            }
            await db
              .update(engagementInbox)
              .set({ status: 'dismissed', updatedAt: new Date() })
              .where(eq(engagementInbox.id, item.inbox_id));
            await recordEngagementAction({
              inboxId: item.inbox_id,
              accountSlot,
              actionType: 'dismiss',
              targetId: null,
              payload: {},
              status: 'success',
            });
            results.push({ index: i, action: 'dismiss', status: 'ok' });
            break;
          }

          default:
            results.push({ index: i, action: String(item.action), status: 'error', error: 'Unknown action.' });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        results.push({ index: i, action: item.action, status: 'error', error: message });
      }
    }

    const succeeded = results.filter((r) => r.status === 'ok').length;
    const failed = results.filter((r) => r.status === 'error').length;

    return NextResponse.json({ results, summary: { total: items.length, succeeded, failed } });
  } catch (error) {
    console.error('Bulk engagement error:', error);
    return NextResponse.json({ error: 'Failed to process bulk actions.' }, { status: 500 });
  }
}
