import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { fetchMentionsTimeline, listDirectMessages } from '@/lib/twitter-api-client';
import { parseAccountSlot, requireConnectedAccount } from '@/lib/engagement-ops';

type SyncBody = {
  account_slot?: unknown;
  include_mentions?: unknown;
  include_dms?: unknown;
  count?: unknown;
  since_id?: unknown;
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function asCount(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    let body: SyncBody = {};
    try {
      body = (await req.json()) as SyncBody;
    } catch {
      body = {};
    }

    const accountSlot = parseAccountSlot(body.account_slot ?? 1);
    const includeMentions = asBool(body.include_mentions, true);
    const includeDms = asBool(body.include_dms, false);
    const count = asCount(body.count, 25);
    const sinceId = asString(body.since_id);

    if (!includeMentions && !includeDms) {
      return NextResponse.json({ error: 'Enable at least one source (include_mentions/include_dms).' }, { status: 400 });
    }

    const account = await requireConnectedAccount(accountSlot);

    let mentionCount = 0;
    let dmCount = 0;

    if (includeMentions) {
      const mentions = await fetchMentionsTimeline(
        account.twitterAccessToken,
        account.twitterAccessTokenSecret,
        {
          count,
          sinceId: sinceId || undefined,
        },
      );

      for (const mention of mentions) {
        await db
          .insert(engagementInbox)
          .values({
            accountSlot,
            sourceType: 'mention',
            sourceId: mention.sourceId,
            conversationId: mention.inReplyToTweetId,
            authorUserId: mention.authorUserId,
            authorUsername: mention.authorUsername,
            text: mention.text,
            rawPayload: JSON.stringify(mention.raw),
            receivedAt: mention.createdAt ? new Date(mention.createdAt) : new Date(),
            status: 'new',
          })
          .onConflictDoUpdate({
            target: [engagementInbox.accountSlot, engagementInbox.sourceType, engagementInbox.sourceId],
            set: {
              conversationId: mention.inReplyToTweetId,
              authorUserId: mention.authorUserId,
              authorUsername: mention.authorUsername,
              text: mention.text,
              rawPayload: JSON.stringify(mention.raw),
              receivedAt: mention.createdAt ? new Date(mention.createdAt) : new Date(),
              updatedAt: new Date(),
            },
          });
      }
      mentionCount = mentions.length;
    }

    if (includeDms) {
      const dms = await listDirectMessages(
        account.twitterAccessToken,
        account.twitterAccessTokenSecret,
        { count },
      );

      for (const dm of dms) {
        await db
          .insert(engagementInbox)
          .values({
            accountSlot,
            sourceType: 'dm',
            sourceId: dm.sourceId,
            conversationId: dm.recipientUserId,
            authorUserId: dm.senderUserId,
            authorUsername: null,
            text: dm.text,
            rawPayload: JSON.stringify(dm.raw),
            receivedAt: dm.createdAt ? new Date(dm.createdAt) : new Date(),
            status: 'new',
          })
          .onConflictDoUpdate({
            target: [engagementInbox.accountSlot, engagementInbox.sourceType, engagementInbox.sourceId],
            set: {
              conversationId: dm.recipientUserId,
              authorUserId: dm.senderUserId,
              text: dm.text,
              rawPayload: JSON.stringify(dm.raw),
              receivedAt: dm.createdAt ? new Date(dm.createdAt) : new Date(),
              updatedAt: new Date(),
            },
          });
      }
      dmCount = dms.length;
    }

    return NextResponse.json({
      ok: true,
      accountSlot,
      synced: {
        mentions: mentionCount,
        dms: dmCount,
      },
    });
  } catch (error) {
    console.error('Failed to sync engagement inbox:', error);
    const message = error instanceof Error ? error.message : 'Failed to sync engagement inbox.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
