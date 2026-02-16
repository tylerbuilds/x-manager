import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agentWebhooks } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertPublicUrl } from '@/lib/network-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_EVENTS = [
  'post.published', 'post.failed', 'post.scheduled',
  'task.completed', 'task.failed',
  'approval.requested', 'approval.decided',
  'campaign.started', 'campaign.completed',
  'run.completed', 'run.failed',
  '*',
];

// GET - list all webhooks
export async function GET() {
  const webhooks = await db.select().from(agentWebhooks);
  return NextResponse.json({
    webhooks: webhooks.map((wh) => ({
      id: wh.id,
      url: wh.url,
      events: JSON.parse(wh.events),
      active: wh.active,
      description: wh.description,
      failureCount: wh.failureCount,
      lastDeliveredAt: wh.lastDeliveredAt?.toISOString() || null,
      createdAt: wh.createdAt?.toISOString() || null,
    })),
  });
}

// POST - register a new webhook
export async function POST(request: NextRequest) {
  let body: { url?: string; events?: string[]; secret?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  if (!body.url || typeof body.url !== 'string') {
    return NextResponse.json({ error: 'url is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    assertPublicUrl(body.url);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'url must be a valid public URL.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
    return NextResponse.json({ error: 'events array is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const invalidEvents = body.events.filter((e) => !ALLOWED_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    return NextResponse.json(
      { error: `Invalid events: ${invalidEvents.join(', ')}`, code: 'VALIDATION_ERROR', allowedEvents: ALLOWED_EVENTS },
      { status: 400 },
    );
  }

  const result = await db.insert(agentWebhooks).values({
    url: body.url,
    events: JSON.stringify(body.events),
    secret: body.secret || null,
    description: body.description || null,
  }).returning();

  const created = result[0];
  return NextResponse.json({
    id: created.id,
    url: created.url,
    events: JSON.parse(created.events),
    active: created.active,
    description: created.description,
  }, { status: 201 });
}

// DELETE - remove a webhook by id (passed as ?id=N)
export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'));
  if (!id || !Number.isFinite(id)) {
    return NextResponse.json({ error: 'id query param is required.', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const deleted = await db.delete(agentWebhooks).where(eq(agentWebhooks.id, id)).returning();
  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Webhook not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: deleted[0].id });
}
