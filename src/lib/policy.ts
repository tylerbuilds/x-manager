import { db, sqlite } from './db';
import { appSettings } from './db/schema';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types & defaults
// ---------------------------------------------------------------------------

export type SlotPolicy = {
  maxPostsPerDay: number;
  maxRepliesPerHour: number;
  maxDmsPerDay: number;
  maxLikesPerHour: number;
  allowedWindowStart: number; // hour 0-23
  allowedWindowEnd: number;   // hour 0-23
  timezone: string;
};

const DEFAULT_POLICY: SlotPolicy = {
  maxPostsPerDay: 25,
  maxRepliesPerHour: 20,
  maxDmsPerDay: 10,
  maxLikesPerHour: 50,
  allowedWindowStart: 6,
  allowedWindowEnd: 23,
  timezone: 'UTC',
};

function settingKey(slot: 1 | 2): string {
  return `policy_slot_${slot}`;
}

// ---------------------------------------------------------------------------
// Read / write policy
// ---------------------------------------------------------------------------

export async function getSlotPolicy(slot: 1 | 2): Promise<SlotPolicy> {
  const rows = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.settingKey, settingKey(slot)))
    .limit(1);

  if (rows.length === 0) {
    return { ...DEFAULT_POLICY };
  }

  try {
    const stored = JSON.parse(rows[0].settingValue) as Partial<SlotPolicy>;
    return { ...DEFAULT_POLICY, ...stored };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}

export async function saveSlotPolicy(
  slot: 1 | 2,
  policy: Partial<SlotPolicy>,
): Promise<void> {
  const existing = await getSlotPolicy(slot);
  const merged: SlotPolicy = { ...existing, ...policy };
  const value = JSON.stringify(merged);

  await db
    .insert(appSettings)
    .values({
      settingKey: settingKey(slot),
      settingValue: value,
    })
    .onConflictDoUpdate({
      target: appSettings.settingKey,
      set: {
        settingValue: value,
        updatedAt: new Date(),
      },
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get current hour (0-23) in the given IANA timezone. */
function currentHourInTz(timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return Number(formatter.format(new Date()));
}

/** Get the hour (0-23) of a Date in the given IANA timezone. */
function hourOfDateInTz(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  return Number(formatter.format(date));
}

/**
 * Check whether `hour` falls inside the allowed window.
 * Handles wrapping (e.g. start=22, end=6 means 22-23 and 0-6).
 */
function isInsideWindow(
  hour: number,
  windowStart: number,
  windowEnd: number,
): boolean {
  if (windowStart <= windowEnd) {
    // Normal range, e.g. 6..23
    return hour >= windowStart && hour < windowEnd;
  }
  // Wrapping range, e.g. 22..6 means 22,23,0,1,2,3,4,5
  return hour >= windowStart || hour < windowEnd;
}

type CountRow = { cnt: number };

/** Count scheduled_posts for a slot created within [sinceEpoch, now]. */
function countRecentPosts(slot: 1 | 2, sinceEpoch: number): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM scheduled_posts
       WHERE account_slot = ?
         AND status IN ('scheduled', 'posted')
         AND scheduled_time >= ?`,
    )
    .get(slot, sinceEpoch) as CountRow | undefined;
  return row?.cnt ?? 0;
}

/** Count engagement_actions for a slot + action_type created since `sinceEpoch`. */
function countRecentEngagementActions(
  slot: 1 | 2,
  actionType: string,
  sinceEpoch: number,
): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM engagement_actions
       WHERE account_slot = ?
         AND action_type = ?
         AND created_at >= ?`,
    )
    .get(slot, actionType, sinceEpoch) as CountRow | undefined;
  return row?.cnt ?? 0;
}

/** Count scheduled_actions for a slot + action_type scheduled since `sinceEpoch`. */
function countRecentScheduledActions(
  slot: 1 | 2,
  actionType: string,
  sinceEpoch: number,
): number {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM scheduled_actions
       WHERE account_slot = ?
         AND action_type = ?
         AND status IN ('scheduled', 'completed')
         AND scheduled_time >= ?`,
    )
    .get(slot, actionType, sinceEpoch) as CountRow | undefined;
  return row?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

export type CheckPolicyParams = {
  slot: 1 | 2;
  actionType: 'post' | 'reply' | 'dm' | 'like' | 'repost';
  scheduledTime?: Date;
};

export type CheckPolicyResult = { allowed: true } | { allowed: false; reason: string };

export async function checkPolicy(params: CheckPolicyParams): Promise<CheckPolicyResult> {
  const { slot, actionType, scheduledTime } = params;
  const policy = await getSlotPolicy(slot);

  // ---- Time-window check ----
  const checkHour = scheduledTime
    ? hourOfDateInTz(scheduledTime, policy.timezone)
    : currentHourInTz(policy.timezone);

  if (!isInsideWindow(checkHour, policy.allowedWindowStart, policy.allowedWindowEnd)) {
    return {
      allowed: false,
      reason: `Outside allowed posting window (${policy.allowedWindowStart}:00-${policy.allowedWindowEnd}:00 ${policy.timezone})`,
    };
  }

  // ---- Rate-limit checks ----
  const nowEpoch = Math.floor(Date.now() / 1000);
  const oneHourAgo = nowEpoch - 3600;
  const oneDayAgo = nowEpoch - 86400;

  switch (actionType) {
    case 'post': {
      const count =
        countRecentPosts(slot, oneDayAgo) +
        countRecentScheduledActions(slot, 'post', oneDayAgo);
      if (count >= policy.maxPostsPerDay) {
        return {
          allowed: false,
          reason: `Rate limit: max ${policy.maxPostsPerDay} posts/day reached`,
        };
      }
      break;
    }

    case 'reply': {
      const count =
        countRecentEngagementActions(slot, 'reply', oneHourAgo) +
        countRecentScheduledActions(slot, 'reply', oneHourAgo);
      if (count >= policy.maxRepliesPerHour) {
        return {
          allowed: false,
          reason: `Rate limit: max ${policy.maxRepliesPerHour} replies/hour reached`,
        };
      }
      break;
    }

    case 'dm': {
      const count =
        countRecentEngagementActions(slot, 'dm_send', oneDayAgo) +
        countRecentScheduledActions(slot, 'dm', oneDayAgo);
      if (count >= policy.maxDmsPerDay) {
        return {
          allowed: false,
          reason: `Rate limit: max ${policy.maxDmsPerDay} DMs/day reached`,
        };
      }
      break;
    }

    case 'like': {
      const count =
        countRecentEngagementActions(slot, 'like', oneHourAgo) +
        countRecentScheduledActions(slot, 'like', oneHourAgo);
      if (count >= policy.maxLikesPerHour) {
        return {
          allowed: false,
          reason: `Rate limit: max ${policy.maxLikesPerHour} likes/hour reached`,
        };
      }
      break;
    }

    case 'repost': {
      // Reposts are rare; treat them like posts (daily limit).
      const count =
        countRecentEngagementActions(slot, 'repost', oneDayAgo) +
        countRecentScheduledActions(slot, 'repost', oneDayAgo);
      if (count >= policy.maxPostsPerDay) {
        return {
          allowed: false,
          reason: `Rate limit: max ${policy.maxPostsPerDay} posts/day reached (reposts share post quota)`,
        };
      }
      break;
    }
  }

  return { allowed: true };
}

export async function enforcePolicy(params: CheckPolicyParams): Promise<void> {
  const result = await checkPolicy(params);
  if (result.allowed === false) {
    throw new Error(result.reason);
  }
}
