import { sqlite } from '@/lib/db';
import { ACCOUNT_SLOTS, type AccountSlot } from '@/lib/account-slots';

interface SnapshotRow {
  id: number;
  account_slot: number;
  followers_count: number;
  following_count: number;
  snapshot_at: number;
}

interface AccountRow {
  slot: number;
  twitter_user_id: string | null;
  twitter_followers_count: number | null;
  twitter_friends_count: number | null;
}

/**
 * Take a follower snapshot for all connected accounts.
 * Uses the cached counts from x_accounts (updated during auth/sync).
 * Returns the number of snapshots created.
 */
export function takeFollowerSnapshots(): number {
  let created = 0;

  const accounts = sqlite
    .prepare(
      `SELECT slot, twitter_user_id, twitter_followers_count, twitter_friends_count
       FROM x_accounts
       WHERE twitter_user_id IS NOT NULL`,
    )
    .all() as AccountRow[];

  for (const account of accounts) {
    if (account.twitter_followers_count == null) continue;

    // Avoid duplicate snapshots within same hour
    const existing = sqlite
      .prepare(
        `SELECT 1 FROM follower_snapshots
         WHERE account_slot = ? AND snapshot_at > ?
         LIMIT 1`,
      )
      .get(account.slot, Math.floor(Date.now() / 1000) - 3600);

    if (existing) continue;

    sqlite
      .prepare(
        `INSERT INTO follower_snapshots (account_slot, followers_count, following_count, snapshot_at)
         VALUES (?, ?, ?, unixepoch())`,
      )
      .run(
        account.slot,
        account.twitter_followers_count ?? 0,
        account.twitter_friends_count ?? 0,
      );
    created++;
  }

  return created;
}

/**
 * Query follower timeseries for an account slot.
 */
export function getFollowerTimeseries(
  accountSlot: AccountSlot,
  days = 90,
): Array<{ date: string; followers: number; following: number }> {
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  return sqlite
    .prepare(
      `SELECT
        date(snapshot_at, 'unixepoch') as date,
        MAX(followers_count) as followers,
        MAX(following_count) as following
       FROM follower_snapshots
       WHERE account_slot = ? AND snapshot_at >= ?
       GROUP BY date(snapshot_at, 'unixepoch')
       ORDER BY date ASC`,
    )
    .all(accountSlot, since) as Array<{ date: string; followers: number; following: number }>;
}

/**
 * Get follower growth stats (daily deltas).
 */
export function getFollowerGrowth(
  accountSlot: AccountSlot,
  days = 30,
): {
  current: { followers: number; following: number } | null;
  growth: Array<{ date: string; followersDelta: number; followingDelta: number }>;
  totalGrowth: number;
  avgDailyGrowth: number;
} {
  const timeseries = getFollowerTimeseries(accountSlot, days + 1);

  if (timeseries.length === 0) {
    return { current: null, growth: [], totalGrowth: 0, avgDailyGrowth: 0 };
  }

  const current = timeseries[timeseries.length - 1];
  const growth: Array<{ date: string; followersDelta: number; followingDelta: number }> = [];

  for (let i = 1; i < timeseries.length; i++) {
    growth.push({
      date: timeseries[i].date,
      followersDelta: timeseries[i].followers - timeseries[i - 1].followers,
      followingDelta: timeseries[i].following - timeseries[i - 1].following,
    });
  }

  const totalGrowth = timeseries.length >= 2
    ? timeseries[timeseries.length - 1].followers - timeseries[0].followers
    : 0;

  const avgDailyGrowth = growth.length > 0
    ? Math.round((totalGrowth / growth.length) * 100) / 100
    : 0;

  return {
    current: { followers: current.followers, following: current.following },
    growth,
    totalGrowth,
    avgDailyGrowth,
  };
}

declare global {
  var __xManagerFollowerTrackerStarted: boolean | undefined;
}

export function isFollowerTrackerStarted(): boolean {
  return globalThis.__xManagerFollowerTrackerStarted === true;
}

export function markFollowerTrackerStarted(): void {
  globalThis.__xManagerFollowerTrackerStarted = true;
}
