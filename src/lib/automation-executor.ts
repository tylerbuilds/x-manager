import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from './db';
import { automationRuleRuns, automationRules, engagementInbox, inboxTags } from './db/schema';
import { emitEvent, onEvent, type EmitEventOptions } from './events';
import { shouldRunCronNow } from './cron-utils';
import { renderTemplate } from './template-utils';
import { createScheduledPost } from './post-scheduler';
import { parseAccountSlot, recordEngagementAction, requireConnectedAccount } from './engagement-ops';
import { likeTweet, postTweet, repostTweet, sendDirectMessage } from './twitter-api-client';
import { assertPublicUrl } from './network-safety';
import { suggestOptimalTime } from './optimal-time';

type Logger = {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type RuleRow = typeof automationRules.$inferSelect;
type RuleRunStatus = 'success' | 'failed' | 'skipped';

const defaultLogger: Logger = {
  info: (...args) => console.log('[automation]', ...args),
  warn: (...args) => console.warn('[automation]', ...args),
  error: (...args) => console.error('[automation]', ...args),
};

declare global {
  var __xManagerAutomationListenerStarted: boolean | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJsonObject(raw: string | null | undefined, fallback: Record<string, unknown> = {}): Record<string, unknown> {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? fallback;
  } catch {
    return fallback;
  }
}

function parseJsonArray(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>
      : [];
  } catch {
    return [];
  }
}

function resolvePath(source: unknown, path: string): unknown {
  const parts = path.split('.').map((part) => part.trim()).filter(Boolean);
  let current: unknown = source;
  for (const part of parts) {
    const record = asRecord(current);
    if (!record || !(part in record)) {
      return undefined;
    }
    current = record[part];
  }
  return current;
}

function evaluateCondition(condition: Record<string, unknown>, input: unknown): boolean {
  const field = typeof condition.field === 'string' ? condition.field : '';
  const operator = typeof condition.operator === 'string' ? condition.operator : '';
  const expected = condition.value;
  const actual = resolvePath(input, field);

  if (!field || !operator) {
    return true;
  }

  switch (operator) {
    case 'equals':
      return actual === expected;
    case 'contains':
      return String(actual ?? '').toLowerCase().includes(String(expected ?? '').toLowerCase());
    case 'regex': {
      const pattern = String(expected ?? '');
      if (pattern.length > 200) return false; // Prevent ReDoS via complex patterns
      try {
        return new RegExp(pattern, 'i').test(String(actual ?? ''));
      } catch {
        return false;
      }
    }
    case 'gt':
      return Number(actual ?? 0) > Number(expected ?? 0);
    case 'lt':
      return Number(actual ?? 0) < Number(expected ?? 0);
    default:
      return true;
  }
}

function extractPayload(context: Record<string, unknown>): Record<string, unknown> {
  return asRecord(context.payload) ?? {};
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function extractTweetId(context: Record<string, unknown>, actionConfig: Record<string, unknown>): string | null {
  const payload = extractPayload(context);
  return firstString(
    actionConfig.tweet_id,
    actionConfig.target_tweet_id,
    payload.tweetId,
    payload.reply_to_tweet_id,
    payload.sourceId,
    payload.matchId,
    payload.entityId,
  );
}

function extractUserId(context: Record<string, unknown>, actionConfig: Record<string, unknown>): string | null {
  const payload = extractPayload(context);
  return firstString(actionConfig.target_user_id, payload.authorUserId, payload.senderUserId, payload.userId);
}

function extractInboxId(context: Record<string, unknown>, actionConfig: Record<string, unknown>): number | null {
  const payload = extractPayload(context);
  const candidate = actionConfig.inbox_id ?? payload.inboxId ?? (context.entityType === 'inbox' ? context.entityId : null);
  const parsed = Number(candidate);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function logRuleRun(
  ruleId: number,
  triggerType: string,
  triggerSource: string | null,
  status: RuleRunStatus,
  input: unknown,
  output?: unknown,
  error?: string,
): Promise<void> {
  await db.insert(automationRuleRuns).values({
    ruleId,
    triggerType,
    triggerSource,
    status,
    inputJson: input === undefined ? null : JSON.stringify(input),
    outputJson: output === undefined ? null : JSON.stringify(output),
    error: error ?? null,
  });
}

async function markRuleExecuted(rule: RuleRow): Promise<void> {
  await db
    .update(automationRules)
    .set({
      runCount: sql`run_count + 1`,
      lastRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(automationRules.id, rule.id));
}

function emitAutomationOutcome(
  eventType: 'automation.executed' | 'automation.failed',
  rule: RuleRow,
  payload: Record<string, unknown>,
): void {
  emitEvent({
    eventType,
    entityType: 'automation_rule',
    entityId: rule.id,
    accountSlot: rule.accountSlot,
    payload,
  });
}

async function executeRuleAction(rule: RuleRow, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const actionConfig = parseJsonObject(rule.actionConfig);
  const slot = parseAccountSlot(actionConfig.account_slot ?? rule.accountSlot);
  const payload = extractPayload(context);

  switch (rule.actionType) {
    case 'like': {
      const tweetId = extractTweetId(context, actionConfig);
      if (!tweetId) throw new Error('Missing tweet id for like action.');
      const account = await requireConnectedAccount(slot);
      if (!account.twitterUserId) throw new Error('Connected account is missing twitter user id.');
      await likeTweet(account.twitterAccessToken, account.twitterAccessTokenSecret, account.twitterUserId, tweetId);
      await recordEngagementAction({ accountSlot: slot, actionType: 'like', targetId: tweetId, payload, status: 'success' });
      return { ok: true, action: 'like', tweetId };
    }

    case 'repost': {
      const tweetId = extractTweetId(context, actionConfig);
      if (!tweetId) throw new Error('Missing tweet id for repost action.');
      const account = await requireConnectedAccount(slot);
      if (!account.twitterUserId) throw new Error('Connected account is missing twitter user id.');
      await repostTweet(account.twitterAccessToken, account.twitterAccessTokenSecret, account.twitterUserId, tweetId);
      await recordEngagementAction({ accountSlot: slot, actionType: 'repost', targetId: tweetId, payload, status: 'success' });
      return { ok: true, action: 'repost', tweetId };
    }

    case 'reply': {
      const tweetId = extractTweetId(context, actionConfig);
      if (!tweetId) throw new Error('Missing tweet id for reply action.');
      const template = typeof actionConfig.text === 'string'
        ? actionConfig.text
        : typeof actionConfig.reply_template === 'string'
          ? actionConfig.reply_template
          : '';
      const text = renderTemplate(template, { ...payload, payload, rule }).trim();
      if (!text) throw new Error('Reply action produced empty text.');
      const account = await requireConnectedAccount(slot);
      const result = await postTweet(text, account.twitterAccessToken, account.twitterAccessTokenSecret, [], undefined, tweetId);
      if (result.errors?.length) {
        throw new Error(result.errors.map((entry) => entry.message).join(' '));
      }
      await recordEngagementAction({
        accountSlot: slot,
        actionType: 'reply',
        targetId: tweetId,
        payload: { ...payload, text },
        result,
        status: 'success',
      });
      return { ok: true, action: 'reply', tweetId, replyId: result.data?.id ?? null };
    }

    case 'send_dm': {
      const userId = extractUserId(context, actionConfig);
      if (!userId) throw new Error('Missing user id for DM action.');
      const template = typeof actionConfig.text === 'string' ? actionConfig.text : '';
      const text = renderTemplate(template, { ...payload, payload, rule }).trim();
      if (!text) throw new Error('DM action produced empty text.');
      const account = await requireConnectedAccount(slot);
      const result = await sendDirectMessage(account.twitterAccessToken, account.twitterAccessTokenSecret, userId, text);
      await recordEngagementAction({
        accountSlot: slot,
        actionType: 'dm_send',
        targetId: userId,
        payload: { ...payload, text },
        result,
        status: 'success',
      });
      return { ok: true, action: 'send_dm', userId, eventId: result.eventId };
    }

    case 'dismiss': {
      const inboxId = extractInboxId(context, actionConfig);
      if (!inboxId) throw new Error('Missing inbox id for dismiss action.');
      await db.update(engagementInbox).set({ status: 'dismissed', updatedAt: new Date() }).where(eq(engagementInbox.id, inboxId));
      await recordEngagementAction({
        accountSlot: slot,
        actionType: 'dismiss',
        targetId: String(inboxId),
        payload,
        status: 'success',
      });
      return { ok: true, action: 'dismiss', inboxId };
    }

    case 'tag': {
      const inboxId = extractInboxId(context, actionConfig);
      const tag = firstString(actionConfig.tag);
      if (!inboxId || !tag) throw new Error('Tag action requires inbox id and tag.');
      await db.insert(inboxTags).values({ inboxId, tag }).onConflictDoNothing();
      return { ok: true, action: 'tag', inboxId, tag };
    }

    case 'webhook': {
      const url = firstString(actionConfig.url);
      if (!url) throw new Error('Webhook action requires a url.');
      assertPublicUrl(url);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ruleId: rule.id, triggerType: rule.triggerType, context }),
      });
      if (!response.ok) {
        throw new Error(`Webhook action failed with status ${response.status}.`);
      }
      return { ok: true, action: 'webhook', status: response.status };
    }

    case 'schedule_post': {
      const template = typeof actionConfig.text === 'string' ? actionConfig.text : '';
      const text = renderTemplate(template, { ...payload, payload, rule }).trim();
      if (!text) throw new Error('schedule_post action produced empty text.');
      const delayMinutes = Math.max(0, Number(actionConfig.delay_minutes ?? 5));
      const autoOptimalTime = actionConfig.auto_optimal_time === true;
      const scheduledTime = autoOptimalTime ? suggestOptimalTime(slot) : new Date(Date.now() + delayMinutes * 60_000);
      const result = await createScheduledPost({
        accountSlot: slot,
        text,
        scheduledTime,
        sourceUrl: firstString(actionConfig.source_url, payload.url),
      });
      return { ok: true, action: 'schedule_post', postId: result.post.id, skipped: result.skipped };
    }

    default:
      return { ok: false, skipped: true, reason: 'unsupported_action' };
  }
}

async function executeRule(rule: RuleRow, context: Record<string, unknown>, triggerSource: string | null, logger: Logger): Promise<void> {
  const conditions = parseJsonArray(rule.conditions);
  const conditionsPass = conditions.every((condition) => evaluateCondition(condition, context));
  if (!conditionsPass) {
    await logRuleRun(rule.id, rule.triggerType, triggerSource, 'skipped', context, { reason: 'conditions_not_met' });
    return;
  }

  try {
    const output = await executeRuleAction(rule, context);
    await markRuleExecuted(rule);
    await logRuleRun(rule.id, rule.triggerType, triggerSource, 'success', context, output);
    emitAutomationOutcome('automation.executed', rule, { triggerSource, output });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Automation rule failed.';
    await markRuleExecuted(rule);
    await logRuleRun(rule.id, rule.triggerType, triggerSource, 'failed', context, undefined, message);
    emitAutomationOutcome('automation.failed', rule, { triggerSource, error: message });
    logger.error(`Automation rule ${rule.id} failed:`, error);
  }
}

const IGNORED_EVENT_PREFIXES = ['automation.'];

export async function processAutomationEvent(
  event: EmitEventOptions & { id: number; createdAt: number },
  logger: Logger = defaultLogger,
): Promise<void> {
  // Prevent infinite loops: skip events emitted by the automation system itself
  if (IGNORED_EVENT_PREFIXES.some((prefix) => event.eventType.startsWith(prefix))) {
    return;
  }

  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, true), eq(automationRules.triggerType, 'event')))
    .orderBy(desc(automationRules.id));

  for (const rule of rules) {
    const triggerConfig = parseJsonObject(rule.triggerConfig);
    const configuredEvent = triggerConfig.event_type;
    // Rules without event_type configured do NOT match all events (security: prevents catch-all rules)
    const matchesEvent =
      configuredEvent === '*' ||
      configuredEvent === event.eventType ||
      (Array.isArray(configuredEvent) && configuredEvent.includes(event.eventType));

    if (!matchesEvent) continue;
    if (event.accountSlot != null && rule.accountSlot !== event.accountSlot) continue;

    await executeRule(
      rule,
      {
        eventId: event.id,
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        accountSlot: event.accountSlot,
        payload: event.payload ?? {},
        createdAt: event.createdAt,
      },
      event.eventType,
      logger,
    );
  }
}

export async function runScheduledAutomationRules(logger: Logger = defaultLogger): Promise<void> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, true), eq(automationRules.triggerType, 'schedule')))
    .orderBy(desc(automationRules.id));

  const now = new Date();
  for (const rule of rules) {
    const triggerConfig = parseJsonObject(rule.triggerConfig);
    const cronExpression = firstString(triggerConfig.cron);
    if (!cronExpression) continue;
    if (!shouldRunCronNow(cronExpression, now, rule.lastRunAt)) continue;

    await executeRule(rule, { now: now.toISOString(), accountSlot: rule.accountSlot, payload: {} }, 'schedule', logger);
  }
}

export async function runKeywordTriggeredRules(input: {
  accountSlot: 1 | 2;
  searchId?: number;
  matchId: string;
  text: string;
  url: string;
  authorUsername?: string | null;
}, logger: Logger = defaultLogger): Promise<void> {
  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.enabled, true), eq(automationRules.triggerType, 'keyword'), eq(automationRules.accountSlot, input.accountSlot)))
    .orderBy(desc(automationRules.id));

  for (const rule of rules) {
    const triggerConfig = parseJsonObject(rule.triggerConfig);
    const configuredKeywords = Array.isArray(triggerConfig.keywords)
      ? triggerConfig.keywords.map((value) => String(value).trim().toLowerCase()).filter(Boolean)
      : [];

    if (configuredKeywords.length > 0) {
      const haystack = input.text.toLowerCase();
      if (!configuredKeywords.some((keyword) => haystack.includes(keyword))) {
        continue;
      }
    }

    await executeRule(
      rule,
      {
        accountSlot: input.accountSlot,
        payload: {
          searchId: input.searchId,
          matchId: input.matchId,
          text: input.text,
          url: input.url,
          authorUsername: input.authorUsername ?? null,
          tweetId: input.matchId,
        },
      },
      'keyword',
      logger,
    );
  }
}

export function startAutomationEventListener(logger: Logger = defaultLogger): void {
  if (globalThis.__xManagerAutomationListenerStarted) {
    return;
  }

  onEvent((event) => {
    void processAutomationEvent(event, logger);
  });

  globalThis.__xManagerAutomationListenerStarted = true;
}
