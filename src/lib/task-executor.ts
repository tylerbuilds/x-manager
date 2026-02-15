import { eq, and, asc, lte, inArray } from 'drizzle-orm';
import { db, sqlite } from './db';
import {
  campaignTasks,
  campaigns,
  campaignApprovals,
} from './db/schema';
import { requireConnectedAccount, recordEngagementAction } from './engagement-ops';
import { postTweet, sendDirectMessage, likeTweet, repostTweet } from './twitter-api-client';
import { checkPolicy } from './policy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExecuteTaskOptions = {
  dryRun?: boolean;
  idempotencyKey?: string;
  actor?: string;
};

export type ExecuteTaskResult = {
  runId: number;
  taskId: number;
  status: 'completed' | 'failed' | 'skipped' | 'waiting_approval' | 'dry_run';
  output?: unknown;
  error?: string;
  steps: Array<{ stepType: string; status: string; output?: unknown; error?: string }>;
};

export type ExecuteCampaignOptions = {
  maxTasks?: number;
  dryRun?: boolean;
  onlyTypes?: string[];
  until?: Date;
  actor?: string;
};

export type ExecuteCampaignResult = {
  runId: number;
  campaignId: number;
  tasksProcessed: number;
  results: ExecuteTaskResult[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowTimestamp(): number {
  return Math.floor(Date.now() / 1000);
}

function parseDetailsJson(details: string | null): Record<string, unknown> {
  if (!details) return {};
  try {
    const parsed = JSON.parse(details);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { raw: details };
  } catch {
    return { raw: details };
  }
}

/** Insert an agent_runs row and return its id via lastInsertRowid. */
function insertRun(params: {
  campaignId: number | null;
  dryRun: boolean;
  requestedBy: string | null;
  inputJson: string | null;
}): number {
  const now = nowTimestamp();
  const stmt = sqlite.prepare(`
    INSERT INTO agent_runs (campaign_id, status, dry_run, requested_by, input_json, started_at, created_at, updated_at)
    VALUES (?, 'running', ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    params.campaignId,
    params.dryRun ? 1 : 0,
    params.requestedBy,
    params.inputJson,
    now,
    now,
    now,
  );
  return Number(info.lastInsertRowid);
}

/** Insert an agent_run_steps row and return its id. */
function insertStep(params: {
  runId: number;
  taskId: number | null;
  stepType: string;
  inputJson: string | null;
}): number {
  const now = nowTimestamp();
  const stmt = sqlite.prepare(`
    INSERT INTO agent_run_steps (run_id, task_id, step_type, status, input_json, started_at, created_at)
    VALUES (?, ?, ?, 'running', ?, ?, ?)
  `);
  const info = stmt.run(params.runId, params.taskId, params.stepType, params.inputJson, now, now);
  return Number(info.lastInsertRowid);
}

function completeStep(stepId: number, status: 'completed' | 'failed' | 'skipped', output: unknown, error?: string): void {
  const now = nowTimestamp();
  sqlite
    .prepare(`UPDATE agent_run_steps SET status = ?, output_json = ?, error = ?, finished_at = ? WHERE id = ?`)
    .run(status, output !== undefined ? JSON.stringify(output) : null, error ?? null, now, stepId);
}

function completeRun(runId: number, status: 'completed' | 'failed' | 'cancelled', outputJson: unknown, error?: string): void {
  const now = nowTimestamp();
  sqlite
    .prepare(`UPDATE agent_runs SET status = ?, output_json = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, outputJson !== undefined ? JSON.stringify(outputJson) : null, error ?? null, now, now, runId);
}

// ---------------------------------------------------------------------------
// Task type executors
// ---------------------------------------------------------------------------

async function executeResearchTask(
  _task: typeof campaignTasks.$inferSelect,
  _details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  // Placeholder: real implementation would call discovery / search APIs
  return {
    output: {
      summary: 'Research placeholder - discovery APIs not yet integrated.',
      collectedAt: new Date().toISOString(),
    },
  };
}

async function executePostTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? (details.raw as string) ?? task.title;
  const accountSlot = (details.accountSlot as number) ?? 1;

  const policyResult = await checkPolicy({ slot: accountSlot as 1 | 2, actionType: 'post' });
  if (!policyResult.allowed) {
    throw new Error(`Policy rejected: ${policyResult.reason}`);
  }

  const account = await requireConnectedAccount(accountSlot as 1 | 2);
  const mediaIds = Array.isArray(details.mediaIds) ? (details.mediaIds as string[]) : [];
  const communityId = (details.communityId as string) ?? undefined;
  const replyToTweetId = (details.replyToTweetId as string) ?? undefined;

  const result = await postTweet(
    content,
    account.twitterAccessToken,
    account.twitterAccessTokenSecret,
    mediaIds,
    communityId,
    replyToTweetId,
  );

  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }

  return { output: result.data };
}

async function executeReplyTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? task.title;
  const replyToTweetId = details.replyToTweetId as string;
  const accountSlot = (details.accountSlot as number) ?? 1;

  if (!replyToTweetId) {
    throw new Error('Reply task missing replyToTweetId in details.');
  }

  const policyResult = await checkPolicy({ slot: accountSlot as 1 | 2, actionType: 'reply' });
  if (!policyResult.allowed) {
    throw new Error(`Policy rejected: ${policyResult.reason}`);
  }

  const account = await requireConnectedAccount(accountSlot as 1 | 2);

  const result = await postTweet(
    content,
    account.twitterAccessToken,
    account.twitterAccessTokenSecret,
    [],
    undefined,
    replyToTweetId,
  );

  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join('; '));
  }

  await recordEngagementAction({
    accountSlot: accountSlot as 1 | 2,
    actionType: 'reply',
    targetId: replyToTweetId,
    payload: { content, taskId: task.id },
    result: result.data,
    status: 'success',
  });

  return { output: result.data };
}

async function executeDmTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const content = (details.content as string) ?? (details.text as string) ?? task.title;
  const recipientUserId = details.recipientUserId as string;
  const accountSlot = (details.accountSlot as number) ?? 1;

  if (!recipientUserId) {
    throw new Error('DM task missing recipientUserId in details.');
  }

  const policyResult = await checkPolicy({ slot: accountSlot as 1 | 2, actionType: 'dm' });
  if (!policyResult.allowed) {
    throw new Error(`Policy rejected: ${policyResult.reason}`);
  }

  const account = await requireConnectedAccount(accountSlot as 1 | 2);

  const result = await sendDirectMessage(
    account.twitterAccessToken,
    account.twitterAccessTokenSecret,
    recipientUserId,
    content,
  );

  await recordEngagementAction({
    accountSlot: accountSlot as 1 | 2,
    actionType: 'dm_send',
    targetId: recipientUserId,
    payload: { content, taskId: task.id },
    result,
    status: 'success',
  });

  return { output: result };
}

async function executeLikeTask(
  task: typeof campaignTasks.$inferSelect,
  details: Record<string, unknown>,
): Promise<{ output: unknown }> {
  const tweetIds = Array.isArray(details.tweetIds)
    ? (details.tweetIds as string[])
    : typeof details.tweetId === 'string'
      ? [details.tweetId as string]
      : [];
  const accountSlot = (details.accountSlot as number) ?? 1;

  if (tweetIds.length === 0) {
    throw new Error('Like task missing tweetIds or tweetId in details.');
  }

  const policyResult = await checkPolicy({ slot: accountSlot as 1 | 2, actionType: 'like' });
  if (!policyResult.allowed) {
    throw new Error(`Policy rejected: ${policyResult.reason}`);
  }

  const account = await requireConnectedAccount(accountSlot as 1 | 2);
  const results: Array<{ tweetId: string; status: string }> = [];

  for (const tweetId of tweetIds) {
    try {
      await likeTweet(
        account.twitterAccessToken,
        account.twitterAccessTokenSecret,
        account.twitterUserId!,
        tweetId,
      );
      results.push({ tweetId, status: 'liked' });

      await recordEngagementAction({
        accountSlot: accountSlot as 1 | 2,
        actionType: 'like',
        targetId: tweetId,
        payload: { taskId: task.id },
        status: 'success',
      });
    } catch (err) {
      results.push({ tweetId, status: `failed: ${err instanceof Error ? err.message : 'unknown'}` });
    }
  }

  return { output: results };
}

// ---------------------------------------------------------------------------
// Approval gating
// ---------------------------------------------------------------------------

async function ensureApproval(
  task: typeof campaignTasks.$inferSelect,
): Promise<{ approved: boolean; approvalId: number }> {
  // Check for existing approved approval
  if (task.approvalId) {
    const existing = await db
      .select()
      .from(campaignApprovals)
      .where(eq(campaignApprovals.id, task.approvalId))
      .limit(1);

    if (existing[0]) {
      return { approved: existing[0].status === 'approved', approvalId: existing[0].id };
    }
  }

  // Check for an approval linked to this task
  const linked = await db
    .select()
    .from(campaignApprovals)
    .where(eq(campaignApprovals.taskId, task.id))
    .limit(1);

  if (linked[0]) {
    // Sync the approvalId on the task if not set
    if (!task.approvalId) {
      await db
        .update(campaignTasks)
        .set({ approvalId: linked[0].id, updatedAt: new Date() })
        .where(eq(campaignTasks.id, task.id));
    }
    return { approved: linked[0].status === 'approved', approvalId: linked[0].id };
  }

  // Create a new pending approval
  const [newApproval] = await db
    .insert(campaignApprovals)
    .values({
      campaignId: task.campaignId,
      taskId: task.id,
      requestedBy: 'agent',
      status: 'pending',
    })
    .returning();

  await db
    .update(campaignTasks)
    .set({ approvalId: newApproval.id, updatedAt: new Date() })
    .where(eq(campaignTasks.id, task.id));

  return { approved: false, approvalId: newApproval.id };
}

// ---------------------------------------------------------------------------
// executeTask
// ---------------------------------------------------------------------------

export async function executeTask(
  taskId: number,
  options: ExecuteTaskOptions = {},
): Promise<ExecuteTaskResult> {
  const { dryRun = false, actor = 'system' } = options;

  // Load task
  const [task] = await db.select().from(campaignTasks).where(eq(campaignTasks.id, taskId)).limit(1);
  if (!task) {
    throw new Error(`Task ${taskId} not found.`);
  }

  // Already terminal
  if (task.status === 'done' || task.status === 'skipped') {
    return {
      runId: 0,
      taskId: task.id,
      status: 'skipped',
      output: task.output ? JSON.parse(task.output) : undefined,
      steps: [],
    };
  }

  // Approval gating
  if (task.requiresApproval || task.taskType === 'approval') {
    const { approved, approvalId } = await ensureApproval(task);
    if (!approved) {
      await db
        .update(campaignTasks)
        .set({ status: 'waiting_approval', approvalId, updatedAt: new Date() })
        .where(eq(campaignTasks.id, task.id));

      return {
        runId: 0,
        taskId: task.id,
        status: 'waiting_approval',
        output: { approvalId, message: 'Task is waiting for approval.' },
        steps: [],
      };
    }
  }

  // Create agent run
  const runId = insertRun({
    campaignId: task.campaignId,
    dryRun,
    requestedBy: actor,
    inputJson: JSON.stringify({ taskId: task.id, taskType: task.taskType, dryRun }),
  });

  const details = parseDetailsJson(task.details);
  const steps: ExecuteTaskResult['steps'] = [];

  // Dry run: plan only
  if (dryRun) {
    const planStepId = insertStep({ runId, taskId: task.id, stepType: 'plan', inputJson: JSON.stringify(details) });
    const planOutput = {
      taskType: task.taskType,
      title: task.title,
      details,
      wouldExecute: true,
    };
    completeStep(planStepId, 'completed', planOutput);
    completeRun(runId, 'completed', planOutput);

    steps.push({ stepType: 'plan', status: 'completed', output: planOutput });

    return {
      runId,
      taskId: task.id,
      status: 'dry_run',
      output: planOutput,
      steps,
    };
  }

  // Mark in-progress
  await db
    .update(campaignTasks)
    .set({ status: 'in_progress', updatedAt: new Date() })
    .where(eq(campaignTasks.id, task.id));

  // Execute
  const execStepId = insertStep({
    runId,
    taskId: task.id,
    stepType: task.taskType,
    inputJson: JSON.stringify(details),
  });

  try {
    let result: { output: unknown };

    switch (task.taskType) {
      case 'research':
        result = await executeResearchTask(task, details);
        break;
      case 'post':
        result = await executePostTask(task, details);
        break;
      case 'reply':
        result = await executeReplyTask(task, details);
        break;
      case 'dm':
        result = await executeDmTask(task, details);
        break;
      case 'like':
        result = await executeLikeTask(task, details);
        break;
      case 'approval':
        // If we reach here, approval was already granted above
        result = { output: { message: 'Approval granted, task completed.' } };
        break;
      default:
        throw new Error(`Unknown task type: ${task.taskType}`);
    }

    // Success
    completeStep(execStepId, 'completed', result.output);
    steps.push({ stepType: task.taskType, status: 'completed', output: result.output });

    await db
      .update(campaignTasks)
      .set({
        status: 'done',
        output: JSON.stringify(result.output),
        updatedAt: new Date(),
      })
      .where(eq(campaignTasks.id, task.id));

    completeRun(runId, 'completed', result.output);

    return {
      runId,
      taskId: task.id,
      status: 'completed',
      output: result.output,
      steps,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown execution error';

    completeStep(execStepId, 'failed', undefined, errorMessage);
    steps.push({ stepType: task.taskType, status: 'failed', error: errorMessage });

    await db
      .update(campaignTasks)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(eq(campaignTasks.id, task.id));

    completeRun(runId, 'failed', undefined, errorMessage);

    return {
      runId,
      taskId: task.id,
      status: 'failed',
      error: errorMessage,
      steps,
    };
  }
}

// ---------------------------------------------------------------------------
// executeCampaign
// ---------------------------------------------------------------------------

export async function executeCampaign(
  campaignId: number,
  options: ExecuteCampaignOptions = {},
): Promise<ExecuteCampaignResult> {
  const { maxTasks = 10, dryRun = false, onlyTypes, until, actor = 'system' } = options;

  // Load and validate campaign
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found.`);
  }

  if (campaign.status !== 'active') {
    throw new Error(`Campaign ${campaignId} is not active (status: ${campaign.status}).`);
  }

  // Build task query conditions
  const conditions = [
    eq(campaignTasks.campaignId, campaignId),
    inArray(campaignTasks.status, ['pending', 'failed']),
  ];

  if (until) {
    conditions.push(lte(campaignTasks.dueAt, until));
  }

  // Load eligible tasks
  let eligibleTasks = await db
    .select()
    .from(campaignTasks)
    .where(and(...conditions))
    .orderBy(asc(campaignTasks.priority), asc(campaignTasks.dueAt));

  // Filter by type if specified
  if (onlyTypes && onlyTypes.length > 0) {
    eligibleTasks = eligibleTasks.filter((t) => onlyTypes.includes(t.taskType));
  }

  // Limit
  eligibleTasks = eligibleTasks.slice(0, maxTasks);

  // Create parent run
  const parentRunId = insertRun({
    campaignId,
    dryRun,
    requestedBy: actor,
    inputJson: JSON.stringify({
      campaignId,
      maxTasks,
      dryRun,
      onlyTypes: onlyTypes ?? null,
      until: until?.toISOString() ?? null,
      eligibleTaskCount: eligibleTasks.length,
    }),
  });

  const results: ExecuteTaskResult[] = [];

  for (const task of eligibleTasks) {
    try {
      const result = await executeTask(task.id, { dryRun, actor });
      results.push(result);
    } catch (err) {
      // Single task failure should not stop the campaign
      results.push({
        runId: parentRunId,
        taskId: task.id,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        steps: [],
      });
    }
  }

  // Determine parent run status
  const hasFailures = results.some((r) => r.status === 'failed');
  const allFailed = results.length > 0 && results.every((r) => r.status === 'failed');
  const parentStatus = allFailed ? 'failed' : 'completed';

  const outputSummary = {
    campaignId,
    tasksProcessed: results.length,
    completed: results.filter((r) => r.status === 'completed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    skipped: results.filter((r) => r.status === 'skipped').length,
    waitingApproval: results.filter((r) => r.status === 'waiting_approval').length,
    dryRun: results.filter((r) => r.status === 'dry_run').length,
  };

  completeRun(
    parentRunId,
    parentStatus,
    outputSummary,
    hasFailures ? `${outputSummary.failed} task(s) failed` : undefined,
  );

  return {
    runId: parentRunId,
    campaignId,
    tasksProcessed: results.length,
    results,
  };
}
