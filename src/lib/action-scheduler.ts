import crypto from 'crypto';
import { and, asc, eq, lte } from 'drizzle-orm';
import { db, sqlite } from './db';
import { scheduledActions, xAccounts } from './db/schema';
import { requireConnectedAccount, recordEngagementAction } from './engagement-ops';
import { postTweet, sendDirectMessage, likeTweet, repostTweet } from './twitter-api-client';
import { getResolvedXConfig } from './x-config';
import { decryptAccountTokens } from './x-account-crypto';
import { checkPolicy } from './policy';
import { normalizeAccountSlot } from './account-slots';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

type LogFn = (...args: unknown[]) => void;

interface ActionSchedulerLogger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const defaultLogger: ActionSchedulerLogger = {
  info: (...args) => console.log('[action-scheduler]', ...args),
  warn: (...args) => console.warn('[action-scheduler]', ...args),
  error: (...args) => console.error('[action-scheduler]', ...args),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ActionSchedulerCycleResult {
  skipped: boolean;
  processed: number;
  completed: number;
  failed: number;
}

interface StartActionSchedulerLoopOptions {
  key?: string;
  intervalSeconds?: number;
  runOnStart?: boolean;
  logger?: ActionSchedulerLogger;
}

// ---------------------------------------------------------------------------
// Lease lock
// ---------------------------------------------------------------------------

const runningLoops = new Map<string, NodeJS.Timeout>();
const actionSchedulerOwnerId = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const actionSchedulerLockKey = 'action-scheduler-cycle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePayloadJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed payload; return empty object.
  }
  return {};
}

function is429Error(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests');
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

export async function runActionSchedulerCycle(
  logger: ActionSchedulerLogger = defaultLogger,
): Promise<ActionSchedulerCycleResult> {
  const leaseSeconds = Math.max(30, Number(process.env.ACTION_SCHEDULER_LOCK_LEASE_SECONDS || 90));
  const nowEpoch = Math.floor(Date.now() / 1000);
  const leaseUntil = nowEpoch + leaseSeconds;

  // Ensure the lock row exists.
  sqlite
    .prepare(
      `INSERT INTO scheduler_locks (lock_key, owner_id, lease_until, created_at, updated_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())
       ON CONFLICT(lock_key) DO NOTHING`,
    )
    .run(actionSchedulerLockKey, actionSchedulerOwnerId, leaseUntil);

  // Attempt to acquire lease.
  const lockAcquireResult = sqlite
    .prepare(
      `UPDATE scheduler_locks
       SET owner_id = ?, lease_until = ?, updated_at = unixepoch()
       WHERE lock_key = ?
         AND (lease_until < ? OR owner_id = ?)`,
    )
    .run(actionSchedulerOwnerId, leaseUntil, actionSchedulerLockKey, nowEpoch, actionSchedulerOwnerId);

  if (lockAcquireResult.changes === 0) {
    logger.warn('Another action-scheduler instance owns the lease. Skipping this cycle.');
    return { skipped: true, processed: 0, completed: 0, failed: 0 };
  }

  try {
    const config = await getResolvedXConfig();

    // Query all due actions.
    const dueActions = await db
      .select()
      .from(scheduledActions)
      .where(
        and(
          eq(scheduledActions.status, 'scheduled'),
          lte(scheduledActions.scheduledTime, new Date()),
        ),
      )
      .orderBy(asc(scheduledActions.scheduledTime), asc(scheduledActions.id));

    if (dueActions.length === 0) {
      return { skipped: false, processed: 0, completed: 0, failed: 0 };
    }

    let completed = 0;
    let failed = 0;

    for (const action of dueActions) {
      try {
        // ---- Resolve account ----
        const accountSlot = normalizeAccountSlot(action.accountSlot, 1);
        const account = await requireConnectedAccount(accountSlot);

        // ---- Check policy ----
        const policyActionType = action.actionType === 'dm' ? 'dm' : action.actionType;
        const policyResult = await checkPolicy({
          slot: accountSlot,
          actionType: policyActionType,
        });

        if (!policyResult.allowed) {
          await updateActionStatus(action.id, 'failed', undefined, policyResult.reason);
          failed += 1;
          logger.warn(`Action ${action.id} blocked by policy: ${policyResult.reason}`);
          continue;
        }

        // ---- Parse payload ----
        const payload = parsePayloadJson(action.payloadJson);

        // ---- Execute action by type ----
        let resultData: unknown = null;
        let engagementActionType: 'reply' | 'dm_send' | 'like' | 'repost' = 'reply';

        switch (action.actionType) {
          case 'reply': {
            engagementActionType = 'reply';
            const text = typeof payload.text === 'string' ? payload.text : '';
            if (!text) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing reply text in payload.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing reply text.`);
              continue;
            }

            const tweetResult = await postTweet(
              text,
              account.twitterAccessToken,
              account.twitterAccessTokenSecret,
              [],
              undefined,
              action.targetId || undefined,
              config,
            );

            if (tweetResult.errors && tweetResult.errors.length > 0) {
              const message = tweetResult.errors.map((e) => e.message).join(', ');
              await updateActionStatus(action.id, 'failed', JSON.stringify(tweetResult), message);
              await recordEngagementAction({
                accountSlot,
                actionType: 'reply',
                targetId: action.targetId,
                payload,
                result: tweetResult,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (reply) failed: ${message}`);
              continue;
            }

            resultData = tweetResult;
            break;
          }

          case 'dm': {
            engagementActionType = 'dm_send';
            const dmText = typeof payload.text === 'string' ? payload.text : '';
            const recipientUserId = action.targetId || (typeof payload.recipientUserId === 'string' ? payload.recipientUserId : '');

            if (!dmText || !recipientUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing DM text or recipient user ID.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing DM text or recipient.`);
              continue;
            }

            try {
              const dmResult = await sendDirectMessage(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                recipientUserId,
                dmText,
                config,
              );
              resultData = dmResult;
            } catch (dmError) {
              const message = dmError instanceof Error ? dmError.message : 'Failed to send DM';
              const retryable = is429Error(dmError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'dm_send',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (dm) failed: ${message}`);
              continue;
            }
            break;
          }

          case 'like': {
            engagementActionType = 'like';
            const tweetId = action.targetId;
            if (!tweetId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing target tweet ID for like.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing target tweet ID.`);
              continue;
            }

            if (!account.twitterUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Account missing twitterUserId for like.');
              failed += 1;
              logger.error(`Action ${action.id} failed: account missing twitterUserId.`);
              continue;
            }

            try {
              await likeTweet(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                account.twitterUserId,
                tweetId,
                config,
              );
              resultData = { liked: true, tweetId };
            } catch (likeError) {
              const message = likeError instanceof Error ? likeError.message : 'Failed to like tweet';
              const retryable = is429Error(likeError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'like',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (like) failed: ${message}`);
              continue;
            }
            break;
          }

          case 'repost': {
            engagementActionType = 'repost';
            const repostTweetId = action.targetId;
            if (!repostTweetId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Missing target tweet ID for repost.');
              failed += 1;
              logger.error(`Action ${action.id} failed: missing target tweet ID.`);
              continue;
            }

            if (!account.twitterUserId) {
              await updateActionStatus(action.id, 'failed', undefined, 'Account missing twitterUserId for repost.');
              failed += 1;
              logger.error(`Action ${action.id} failed: account missing twitterUserId.`);
              continue;
            }

            try {
              await repostTweet(
                account.twitterAccessToken,
                account.twitterAccessTokenSecret,
                account.twitterUserId,
                repostTweetId,
                config,
              );
              resultData = { reposted: true, tweetId: repostTweetId };
            } catch (repostError) {
              const message = repostError instanceof Error ? repostError.message : 'Failed to repost tweet';
              const retryable = is429Error(repostError);
              await updateActionStatus(
                action.id,
                'failed',
                undefined,
                retryable ? `Rate limited (429): ${message}` : message,
              );
              await recordEngagementAction({
                accountSlot,
                actionType: 'repost',
                targetId: action.targetId,
                payload,
                status: 'failed',
                errorMessage: message,
              });
              failed += 1;
              logger.error(`Action ${action.id} (repost) failed: ${message}`);
              continue;
            }
            break;
          }

          default: {
            await updateActionStatus(action.id, 'failed', undefined, `Unknown action_type: ${action.actionType}`);
            failed += 1;
            logger.error(`Action ${action.id} failed: unknown action_type "${action.actionType}".`);
            continue;
          }
        }

        // ---- Mark completed ----
        await updateActionStatus(action.id, 'completed', JSON.stringify(resultData));
        await recordEngagementAction({
          accountSlot,
          actionType: engagementActionType,
          targetId: action.targetId,
          payload,
          result: resultData,
          status: 'success',
        });
        completed += 1;
        logger.info(`Action ${action.id} (${action.actionType}) completed successfully.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const retryable = is429Error(error);
        const errorText = retryable ? `Rate limited (429): ${message}` : message;

        await updateActionStatus(action.id, 'failed', undefined, errorText);
        failed += 1;
        logger.error(`Action ${action.id} failed with exception: ${errorText}`);
      }
    }

    return {
      skipped: false,
      processed: dueActions.length,
      completed,
      failed,
    };
  } finally {
    sqlite
      .prepare(
        `UPDATE scheduler_locks
         SET lease_until = 0, updated_at = unixepoch()
         WHERE lock_key = ? AND owner_id = ?`,
      )
      .run(actionSchedulerLockKey, actionSchedulerOwnerId);
  }
}

// ---------------------------------------------------------------------------
// Status update helper
// ---------------------------------------------------------------------------

async function updateActionStatus(
  actionId: number,
  status: 'completed' | 'failed' | 'cancelled',
  resultJson?: string,
  errorMessage?: string,
): Promise<void> {
  await db
    .update(scheduledActions)
    .set({
      status,
      resultJson: resultJson ?? null,
      error: errorMessage ?? null,
      updatedAt: new Date(),
    })
    .where(eq(scheduledActions.id, actionId));
}

// ---------------------------------------------------------------------------
// Loop management
// ---------------------------------------------------------------------------

export function startActionSchedulerLoop(options: StartActionSchedulerLoopOptions = {}): () => void {
  const key = options.key || 'action-scheduler';
  const logger = options.logger || defaultLogger;
  const intervalSeconds = Math.max(10, Math.floor(options.intervalSeconds || 30));
  const runOnStart = options.runOnStart !== false;

  if (runningLoops.has(key)) {
    logger.info(`Loop "${key}" already active. Skipping duplicate start.`);
    return () => {
      const timer = runningLoops.get(key);
      if (timer) {
        clearInterval(timer);
        runningLoops.delete(key);
      }
    };
  }

  if (runOnStart) {
    void runActionSchedulerCycle(logger).then((result) => {
      if (result.processed > 0) {
        logger.info(`Initial cycle processed ${result.processed} actions.`);
      }
    });
  }

  const timer = setInterval(() => {
    void runActionSchedulerCycle(logger).catch((error) => {
      logger.error('Action scheduler cycle error:', error);
    });
  }, intervalSeconds * 1000);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  runningLoops.set(key, timer);
  logger.info(`Action scheduler loop "${key}" started (${intervalSeconds}s interval).`);

  return () => {
    const loop = runningLoops.get(key);
    if (loop) {
      clearInterval(loop);
      runningLoops.delete(key);
      logger.info(`Action scheduler loop "${key}" stopped.`);
    }
  };
}
