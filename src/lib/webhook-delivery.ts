import crypto from 'crypto';
import { db, sqlite } from '@/lib/db';
import { agentWebhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertPublicUrl } from '@/lib/network-safety';
import type { EmitEventOptions } from './events';

export type WebhookEvent =
  | 'post.published'
  | 'post.failed'
  | 'post.scheduled'
  | 'task.completed'
  | 'task.failed'
  | 'approval.requested'
  | 'approval.decided'
  | 'campaign.started'
  | 'campaign.completed'
  | 'run.completed'
  | 'run.failed';

const MAX_FAILURE_COUNT = 5;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [5_000, 30_000, 300_000]; // 5s, 30s, 5min
const DELIVERY_TIMEOUT_MS = 10_000;

interface WebhookRow {
  id: number;
  url: string;
  events: string;
  secret: string | null;
  active: number;
}

/**
 * Legacy interface: Fire a webhook event by event name.
 */
export async function fireWebhookEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  const webhooks = await db
    .select()
    .from(agentWebhooks)
    .where(eq(agentWebhooks.active, true));

  const matching = webhooks.filter((wh) => {
    try {
      const events = JSON.parse(wh.events) as string[];
      return events.includes(event) || events.includes('*');
    } catch {
      return false;
    }
  });

  for (const webhook of matching) {
    deliverWebhookLegacy(webhook, event, payload).catch((err) => {
      console.error(`Webhook delivery failed for ${webhook.url}:`, err);
    });
  }
}

/**
 * New interface: Deliver an event to all matching webhooks with delivery tracking + retry.
 */
export function deliverEventToWebhooks(eventId: number, options: EmitEventOptions): void {
  const webhooks = sqlite
    .prepare(`SELECT id, url, events, secret, active FROM agent_webhooks WHERE active = 1`)
    .all() as WebhookRow[];

  for (const webhook of webhooks) {
    let events: string[];
    try {
      events = JSON.parse(webhook.events);
    } catch {
      continue;
    }
    if (!events.includes('*') && !events.includes(options.eventType)) {
      continue;
    }

    const deliveryId = recordDeliveryAttempt(webhook.id, eventId);
    void attemptTrackedDelivery(webhook, eventId, deliveryId, options, 1);
  }
}

function recordDeliveryAttempt(webhookId: number, eventId: number): number {
  const result = sqlite
    .prepare(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, status, attempts, created_at)
       VALUES (?, ?, 'pending', 0, unixepoch())`,
    )
    .run(webhookId, eventId);
  return Number(result.lastInsertRowid);
}

async function attemptTrackedDelivery(
  webhook: WebhookRow,
  eventId: number,
  deliveryId: number,
  event: EmitEventOptions,
  attempt: number,
): Promise<void> {
  const body = JSON.stringify({
    event: event.eventType,
    entity_type: event.entityType,
    entity_id: String(event.entityId),
    account_slot: event.accountSlot ?? null,
    payload: event.payload ?? null,
    event_id: eventId,
    timestamp: new Date().toISOString(),
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'x-manager-webhook/1.0',
    'X-Webhook-Event': event.eventType,
    'X-Webhook-Delivery': String(deliveryId),
  };

  if (webhook.secret) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');
    headers['X-Webhook-Signature'] = `sha256=${signature}`;
  }

  try {
    await assertPublicUrl(webhook.url);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    const responseBody = await response.text().catch(() => '');

    sqlite
      .prepare(
        `UPDATE webhook_deliveries
         SET status = ?, attempts = ?, last_attempt_at = unixepoch(),
             response_status = ?, response_body = ?
         WHERE id = ?`,
      )
      .run(
        response.ok ? 'delivered' : 'failed',
        attempt,
        response.status,
        responseBody.slice(0, 2000),
        deliveryId,
      );

    if (response.ok) {
      await db
        .update(agentWebhooks)
        .set({ failureCount: 0, lastDeliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(agentWebhooks.id, webhook.id));
    } else if (attempt < MAX_ATTEMPTS) {
      scheduleRetry(webhook, eventId, deliveryId, event, attempt);
    } else {
      incrementFailureCountRaw(webhook.id);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    sqlite
      .prepare(
        `UPDATE webhook_deliveries
         SET status = 'failed', attempts = ?, last_attempt_at = unixepoch(),
             response_body = ?
         WHERE id = ?`,
      )
      .run(attempt, errorMsg.slice(0, 2000), deliveryId);

    if (attempt < MAX_ATTEMPTS) {
      scheduleRetry(webhook, eventId, deliveryId, event, attempt);
    } else {
      incrementFailureCountRaw(webhook.id);
    }
  }
}

function scheduleRetry(
  webhook: WebhookRow,
  eventId: number,
  deliveryId: number,
  event: EmitEventOptions,
  attempt: number,
): void {
  const delay = RETRY_DELAYS_MS[attempt - 1] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  setTimeout(() => {
    void attemptTrackedDelivery(webhook, eventId, deliveryId, event, attempt + 1);
  }, delay);
}

function incrementFailureCountRaw(webhookId: number): void {
  sqlite
    .prepare(
      `UPDATE agent_webhooks
       SET failure_count = MIN(failure_count + 1, ?),
           active = CASE WHEN failure_count + 1 >= ? THEN 0 ELSE active END,
           updated_at = unixepoch()
       WHERE id = ?`,
    )
    .run(MAX_FAILURE_COUNT, MAX_FAILURE_COUNT, webhookId);
}

// Legacy single-delivery (no tracking table)
async function deliverWebhookLegacy(
  webhook: typeof agentWebhooks.$inferSelect,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({
    event,
    payload,
    timestamp: new Date().toISOString(),
    webhookId: webhook.id,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': event,
  };

  if (webhook.secret) {
    const signature = crypto
      .createHmac('sha256', webhook.secret)
      .update(body)
      .digest('hex');
    headers['X-Webhook-Signature'] = `sha256=${signature}`;
  }

  try {
    await assertPublicUrl(webhook.url);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (response.ok) {
      await db
        .update(agentWebhooks)
        .set({ failureCount: 0, lastDeliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(agentWebhooks.id, webhook.id));
    } else {
      await incrementFailureCount(webhook);
    }
  } catch {
    await incrementFailureCount(webhook);
  }
}

/**
 * S5 fix: Recover pending/failed webhook deliveries that were lost on process restart.
 * Called once on startup to re-attempt deliveries that didn't exhaust their retries.
 */
export function recoverPendingDeliveries(): void {
  try {
    const pending = sqlite
      .prepare(
        `SELECT wd.id, wd.webhook_id, wd.event_id, wd.attempts,
                aw.id as wh_id, aw.url, aw.events, aw.secret, aw.active
         FROM webhook_deliveries wd
         JOIN agent_webhooks aw ON aw.id = wd.webhook_id
         WHERE wd.status IN ('pending', 'failed')
           AND wd.attempts < ?
           AND aw.active = 1
         ORDER BY wd.created_at ASC
         LIMIT 50`,
      )
      .all(MAX_ATTEMPTS) as Array<{
        id: number;
        webhook_id: number;
        event_id: number;
        attempts: number;
        wh_id: number;
        url: string;
        events: string;
        secret: string | null;
        active: number;
      }>;

    if (pending.length === 0) return;
    console.log(`[webhook-delivery] Recovering ${pending.length} pending deliveries.`);

    for (const row of pending) {
      const event = sqlite
        .prepare(`SELECT event_type, entity_type, entity_id, account_slot, payload FROM events WHERE id = ?`)
        .get(row.event_id) as {
          event_type: string;
          entity_type: string;
          entity_id: string;
          account_slot: number | null;
          payload: string | null;
        } | undefined;

      if (!event) {
        sqlite.prepare(`UPDATE webhook_deliveries SET status = 'failed' WHERE id = ?`).run(row.id);
        continue;
      }

      const webhook: WebhookRow = {
        id: row.wh_id,
        url: row.url,
        events: row.events,
        secret: row.secret,
        active: row.active,
      };

      void attemptTrackedDelivery(
        webhook,
        row.event_id,
        row.id,
        {
          eventType: event.event_type as EmitEventOptions['eventType'],
          entityType: event.entity_type,
          entityId: event.entity_id,
          accountSlot: event.account_slot ?? undefined,
          payload: event.payload ? JSON.parse(event.payload) : undefined,
        },
        row.attempts + 1,
      );
    }
  } catch (error) {
    console.error('[webhook-delivery] Failed to recover pending deliveries:', error);
  }
}

async function incrementFailureCount(webhook: typeof agentWebhooks.$inferSelect): Promise<void> {
  const newCount = (webhook.failureCount ?? 0) + 1;
  await db
    .update(agentWebhooks)
    .set({
      failureCount: newCount,
      active: newCount < MAX_FAILURE_COUNT,
      updatedAt: new Date(),
    })
    .where(eq(agentWebhooks.id, webhook.id));
}
