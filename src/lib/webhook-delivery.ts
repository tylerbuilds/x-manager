import crypto from 'crypto';
import { db } from '@/lib/db';
import { agentWebhooks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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
const DELIVERY_TIMEOUT_MS = 10_000;

export async function fireWebhookEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
  // Get all active webhooks subscribed to this event
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

  // Fire-and-forget delivery for each matching webhook
  for (const webhook of matching) {
    deliverWebhook(webhook, event, payload).catch((err) => {
      console.error(`Webhook delivery failed for ${webhook.url}:`, err);
    });
  }
}

async function deliverWebhook(
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
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (response.ok) {
      // Reset failure count on success
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
