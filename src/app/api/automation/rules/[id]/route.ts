import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { automationRules } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(id: string): number | null {
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function serializeRule(rule: typeof automationRules.$inferSelect) {
  return {
    ...rule,
    triggerConfig: JSON.parse(rule.triggerConfig),
    conditions: JSON.parse(rule.conditions),
    actionConfig: JSON.parse(rule.actionConfig),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ruleId = parseId(id);
    if (!ruleId) {
      return NextResponse.json({ error: 'Invalid rule id.' }, { status: 400 });
    }

    const body = asObject(await req.json());
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const updates: Partial<typeof automationRules.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.trigger_type === 'string' && ['event', 'schedule', 'keyword'].includes(body.trigger_type)) {
      updates.triggerType = body.trigger_type as 'event' | 'schedule' | 'keyword';
    }
    if (body.trigger_config && asObject(body.trigger_config)) updates.triggerConfig = JSON.stringify(body.trigger_config);
    if (Array.isArray(body.conditions)) updates.conditions = JSON.stringify(body.conditions);
    if (typeof body.action_type === 'string' && ['like', 'reply', 'repost', 'schedule_post', 'send_dm', 'dismiss', 'tag', 'webhook'].includes(body.action_type)) {
      updates.actionType = body.action_type as typeof automationRules.$inferInsert.actionType;
    }
    if (body.action_config && asObject(body.action_config)) updates.actionConfig = JSON.stringify(body.action_config);
    if (body.enabled === true || body.enabled === false) updates.enabled = body.enabled;
    if (body.account_slot === 1 || body.account_slot === 2) updates.accountSlot = body.account_slot;

    const updated = await db.update(automationRules).set(updates).where(eq(automationRules.id, ruleId)).returning();
    if (!updated[0]) {
      return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, rule: serializeRule(updated[0]) });
  } catch (error) {
    console.error('Failed to update automation rule:', error);
    return NextResponse.json({ error: 'Failed to update automation rule.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ruleId = parseId(id);
    if (!ruleId) {
      return NextResponse.json({ error: 'Invalid rule id.' }, { status: 400 });
    }

    const deleted = await db.delete(automationRules).where(eq(automationRules.id, ruleId)).returning();
    if (!deleted[0]) {
      return NextResponse.json({ error: 'Rule not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, deleted: deleted[0].id });
  } catch (error) {
    console.error('Failed to delete automation rule:', error);
    return NextResponse.json({ error: 'Failed to delete automation rule.' }, { status: 500 });
  }
}
