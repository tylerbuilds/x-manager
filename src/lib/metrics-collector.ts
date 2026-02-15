import crypto from 'crypto';
import { and, eq, isNotNull, desc } from 'drizzle-orm';
import { db, sqlite } from './db';
import { scheduledPosts, postMetrics, xAccounts } from './db/schema';
import { getResolvedXConfig, type ResolvedXConfig } from './x-config';
import { decryptAccountTokens } from './x-account-crypto';

type LogFn = (...args: unknown[]) => void;

interface MetricsLogger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const defaultLogger: MetricsLogger = {
  info: (...args) => console.log('[metrics-collector]', ...args),
  warn: (...args) => console.warn('[metrics-collector]', ...args),
  error: (...args) => console.error('[metrics-collector]', ...args),
};

const metricsOwnerId = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const metricsLockKey = 'metrics-collector';

let runningTimer: NodeJS.Timeout | null = null;

async function getConnectedAccounts() {
  const rows = await db.select().from(xAccounts);
  return rows
    .map((account) => decryptAccountTokens(account))
    .filter((account) => Boolean(account.twitterAccessToken && account.twitterAccessTokenSecret));
}

async function getPostedTweets() {
  return db
    .select({
      id: scheduledPosts.id,
      twitterPostId: scheduledPosts.twitterPostId,
      accountSlot: scheduledPosts.accountSlot,
    })
    .from(scheduledPosts)
    .where(
      and(
        eq(scheduledPosts.status, 'posted'),
        isNotNull(scheduledPosts.twitterPostId),
      ),
    );
}

export async function fetchTweetMetrics(
  ids: string[],
  accessToken: string,
  accessTokenSecret: string,
  config: ResolvedXConfig,
): Promise<Record<string, { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number }>> {
  if (ids.length === 0) return {};

  const OAuth = (await import('oauth-1.0a')).default;
  const CryptoJS = (await import('crypto-js')).default;

  const oauth = new OAuth({
    consumer: { key: config.xApiKey, secret: config.xApiSecret },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64);
    },
  });

  const results: Record<string, { impressions: number; likes: number; retweets: number; replies: number; quotes: number; bookmarks: number }> = {};

  // Batch in chunks of 100 (X API limit)
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = `${config.xApiBaseUrl}/2/tweets?ids=${batch.join(',')}&tweet.fields=public_metrics`;

    const token = { key: accessToken, secret: accessTokenSecret };
    const authHeader = oauth.toHeader(oauth.authorize({ url, method: 'GET' }, token));

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: authHeader.Authorization,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        continue;
      }

      const body = await response.json() as {
        data?: Array<{
          id: string;
          public_metrics?: {
            impression_count?: number;
            like_count?: number;
            retweet_count?: number;
            reply_count?: number;
            quote_count?: number;
            bookmark_count?: number;
          };
        }>;
      };

      if (body.data) {
        for (const tweet of body.data) {
          const m = tweet.public_metrics;
          if (m) {
            results[tweet.id] = {
              impressions: m.impression_count ?? 0,
              likes: m.like_count ?? 0,
              retweets: m.retweet_count ?? 0,
              replies: m.reply_count ?? 0,
              quotes: m.quote_count ?? 0,
              bookmarks: m.bookmark_count ?? 0,
            };
          }
        }
      }
    } catch {
      // Continue with next batch on failure
    }
  }

  return results;
}

export async function runMetricsCollectionCycle(logger: MetricsLogger = defaultLogger): Promise<{ collected: number }> {
  const leaseSeconds = 120;
  const nowEpoch = Math.floor(Date.now() / 1000);
  const leaseUntil = nowEpoch + leaseSeconds;

  // Acquire lease lock
  sqlite
    .prepare(
      `INSERT INTO scheduler_locks (lock_key, owner_id, lease_until, created_at, updated_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(lock_key) DO NOTHING`,
    )
    .run(metricsLockKey, metricsOwnerId, leaseUntil);

  const lockResult = sqlite
    .prepare(
      `UPDATE scheduler_locks
       SET owner_id = ?, lease_until = ?, updated_at = unixepoch()
       WHERE lock_key = ?
         AND (lease_until < ? OR owner_id = ?)`,
    )
    .run(metricsOwnerId, leaseUntil, metricsLockKey, nowEpoch, metricsOwnerId);

  if (lockResult.changes === 0) {
    return { collected: 0 };
  }

  try {
    const config = await getResolvedXConfig();
    const accounts = await getConnectedAccounts();
    if (accounts.length === 0) return { collected: 0 };

    const postedTweets = await getPostedTweets();
    if (postedTweets.length === 0) return { collected: 0 };

    // Group by account slot
    const bySlot = new Map<number, typeof postedTweets>();
    for (const tweet of postedTweets) {
      const slot = tweet.accountSlot;
      if (!bySlot.has(slot)) bySlot.set(slot, []);
      bySlot.get(slot)!.push(tweet);
    }

    let collected = 0;

    for (const account of accounts) {
      const tweets = bySlot.get(account.slot) || [];
      if (tweets.length === 0) continue;

      const tweetIds = tweets
        .map((t) => t.twitterPostId)
        .filter((id): id is string => Boolean(id));

      if (tweetIds.length === 0) continue;

      const metrics = await fetchTweetMetrics(
        tweetIds,
        account.twitterAccessToken!,
        account.twitterAccessTokenSecret!,
        config,
      );

      for (const tweet of tweets) {
        const m = metrics[tweet.twitterPostId!];
        if (!m) continue;

        await db.insert(postMetrics).values({
          scheduledPostId: tweet.id,
          twitterPostId: tweet.twitterPostId!,
          accountSlot: account.slot,
          impressions: m.impressions,
          likes: m.likes,
          retweets: m.retweets,
          replies: m.replies,
          quotes: m.quotes,
          bookmarks: m.bookmarks,
        });
        collected++;
      }
    }

    if (collected > 0) {
      logger.info(`Collected metrics for ${collected} tweets.`);
    }

    return { collected };
  } catch (error) {
    logger.error('Metrics collection cycle failed:', error);
    return { collected: 0 };
  } finally {
    sqlite
      .prepare(
        `UPDATE scheduler_locks
         SET lease_until = 0, updated_at = unixepoch()
         WHERE lock_key = ? AND owner_id = ?`,
      )
      .run(metricsLockKey, metricsOwnerId);
  }
}

export function startMetricsCollectorLoop(intervalSeconds = 900): () => void {
  if (runningTimer) {
    return () => {
      if (runningTimer) {
        clearInterval(runningTimer);
        runningTimer = null;
      }
    };
  }

  const timer = setInterval(() => {
    void runMetricsCollectionCycle().catch((error) => {
      console.error('[metrics-collector] Cycle error:', error);
    });
  }, intervalSeconds * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  runningTimer = timer;
  console.log(`[metrics-collector] Started (${intervalSeconds}s interval).`);

  return () => {
    if (runningTimer) {
      clearInterval(runningTimer);
      runningTimer = null;
    }
  };
}
