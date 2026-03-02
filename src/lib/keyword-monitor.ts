import { and, asc, eq } from 'drizzle-orm';
import { db } from './db';
import { savedSearchMatches, savedSearches } from './db/schema';
import { emitEvent } from './events';
import { searchDiscoveryTopics } from './discovery-search';
import { runKeywordTriggeredRules } from './automation-executor';
import { requireConnectedAccount, recordEngagementAction } from './engagement-ops';
import { likeTweet, postTweet } from './twitter-api-client';
import { renderTemplate } from './template-utils';

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

function parseKeywords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((value) => String(value).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function shouldRunSearch(lastCheckedAt: Date | null, intervalMinutes: number): boolean {
  if (!lastCheckedAt) return true;
  return lastCheckedAt.getTime() + intervalMinutes * 60_000 <= Date.now();
}

export async function runKeywordMonitor(logger: Logger): Promise<void> {
  const searches = await db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.status, 'active')))
    .orderBy(asc(savedSearches.id));

  for (const search of searches) {
    if (!shouldRunSearch(search.lastCheckedAt, search.checkIntervalMinutes)) {
      continue;
    }

    const keywords = parseKeywords(search.keywords);
    if (keywords.length === 0) {
      await db.update(savedSearches).set({ lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(savedSearches.id, search.id));
      continue;
    }

    try {
      const result = await searchDiscoveryTopics({
        keywords,
        language: search.language || 'en',
        limit: 10,
      });

      for (const topic of result.topics) {
        const inserted = await db.insert(savedSearchMatches).values({
          searchId: search.id,
          matchId: topic.id,
          matchUrl: topic.url,
          matchText: topic.text,
        }).onConflictDoNothing().returning();

        if (!inserted[0]) {
          continue;
        }

        if (search.notify) {
          emitEvent({
            eventType: 'keyword.match',
            entityType: 'saved_search',
            entityId: search.id,
            accountSlot: search.accountSlot,
            payload: {
              searchId: search.id,
              matchId: topic.id,
              text: topic.text,
              url: topic.url,
              authorUsername: topic.author.username,
            },
          });
        }

        await runKeywordTriggeredRules({
          accountSlot: search.accountSlot as 1 | 2,
          searchId: search.id,
          matchId: topic.id,
          text: topic.text,
          url: topic.url,
          authorUsername: topic.author.username,
        }, logger);

        if (search.autoAction === 'like') {
          const account = await requireConnectedAccount(search.accountSlot as 1 | 2);
          if (!account.twitterUserId) {
            throw new Error(`Saved search ${search.id}: connected account missing twitter user id.`);
          }
          await likeTweet(account.twitterAccessToken, account.twitterAccessTokenSecret, account.twitterUserId, topic.id);
          await db.update(savedSearchMatches).set({ actionStatus: 'liked' }).where(eq(savedSearchMatches.id, inserted[0].id));
          await recordEngagementAction({
            accountSlot: search.accountSlot as 1 | 2,
            actionType: 'like',
            targetId: topic.id,
            payload: { searchId: search.id, url: topic.url },
            status: 'success',
          });
        }

        if (search.autoAction === 'reply') {
          const template = search.replyTemplate || '{suggestedReplyStarter}';
          const text = renderTemplate(template, {
            ...topic,
            suggestedReplyStarter: topic.suggestedReplyStarter,
          }).trim();

          if (!text) {
            continue;
          }

          const account = await requireConnectedAccount(search.accountSlot as 1 | 2);
          const replyResult = await postTweet(text, account.twitterAccessToken, account.twitterAccessTokenSecret, [], undefined, topic.id);
          if (replyResult.errors?.length) {
            throw new Error(replyResult.errors.map((entry) => entry.message).join(' '));
          }

          await db.update(savedSearchMatches).set({ actionStatus: 'replied' }).where(eq(savedSearchMatches.id, inserted[0].id));
          await recordEngagementAction({
            accountSlot: search.accountSlot as 1 | 2,
            actionType: 'reply',
            targetId: topic.id,
            payload: { searchId: search.id, text },
            result: replyResult,
            status: 'success',
          });
        }
      }

      await db.update(savedSearches).set({ lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(savedSearches.id, search.id));
    } catch (error) {
      logger.error(`Keyword monitor failed for saved search ${search.id}:`, error);
      await db.update(savedSearches).set({ lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(savedSearches.id, search.id));
    }
  }
}
