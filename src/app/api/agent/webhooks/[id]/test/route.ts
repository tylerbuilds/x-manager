import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentWebhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { emitEvent } from '@/lib/events';
import { deliverEventToWebhooks } from '@/lib/webhook-delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const webhookId = Number(id);
    if (!Number.isFinite(webhookId)) {
      return NextResponse.json({ error: 'Invalid webhook ID.' }, { status: 400 });
    }

    const [webhook] = await db
      .select()
      .from(agentWebhooks)
      .where(eq(agentWebhooks.id, webhookId))
      .limit(1);

    if (!webhook) {
      return NextResponse.json({ error: 'Webhook not found.' }, { status: 404 });
    }

    // Emit a test event
    const eventId = emitEvent({
      eventType: 'system.error',
      entityType: 'webhook_test',
      entityId: webhookId,
      payload: {
        test: true,
        message: 'This is a test event to verify webhook delivery.',
        webhookId,
      },
    });

    // Deliver to this specific webhook
    deliverEventToWebhooks(eventId, {
      eventType: 'system.error',
      entityType: 'webhook_test',
      entityId: webhookId,
      payload: {
        test: true,
        message: 'This is a test event to verify webhook delivery.',
        webhookId,
      },
    });

    return NextResponse.json({
      ok: true,
      eventId,
      message: 'Test event sent. Check webhook deliveries for result.',
    });
  } catch (error) {
    console.error('Error sending test webhook:', error);
    return NextResponse.json({ error: 'Failed to send test webhook.' }, { status: 500 });
  }
}
