import { and, desc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { automationRules } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseRuleResponse(rule: typeof automationRules.$inferSelect) {
  return {
    ...rule,
    triggerConfig: JSON.parse(rule.triggerConfig),
    conditions: JSON.parse(rule.conditions),
    actionConfig: JSON.parse(rule.actionConfig),
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const enabled = url.searchParams.get('enabled');
    const triggerType = url.searchParams.get('trigger_type');
    const conditions = [];

    if (enabled === 'true' || enabled === 'false') {
      conditions.push(eq(automationRules.enabled, enabled === 'true'));
    }
    if (triggerType) {
      conditions.push(eq(automationRules.triggerType, triggerType as 'event' | 'schedule' | 'keyword'));
    }

    const rows = conditions.length > 0
      ? await db.select().from(automationRules).where(and(...conditions)).orderBy(desc(automationRules.createdAt))
      : await db.select().from(automationRules).orderBy(desc(automationRules.createdAt));

    return NextResponse.json({ rules: rows.map(parseRuleResponse) });
  } catch (error) {
    console.error('Failed to list automation rules:', error);
    return NextResponse.json({ error: 'Failed to list automation rules.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = asObject(await req.json());
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const triggerType = typeof body.trigger_type === 'string' ? body.trigger_type.trim() : '';
    const actionType = typeof body.action_type === 'string' ? body.action_type.trim() : '';
    const accountSlot = Number(body.account_slot ?? 1);

    if (!name || !['event', 'schedule', 'keyword'].includes(triggerType)) {
      return NextResponse.json({ error: 'name and valid trigger_type are required.' }, { status: 400 });
    }
    if (!['like', 'reply', 'repost', 'schedule_post', 'send_dm', 'dismiss', 'tag', 'webhook'].includes(actionType)) {
      return NextResponse.json({ error: 'Invalid action_type.' }, { status: 400 });
    }
    if (accountSlot !== 1 && accountSlot !== 2) {
      return NextResponse.json({ error: 'account_slot must be 1 or 2.' }, { status: 400 });
    }

    const triggerConfig = asObject(body.trigger_config) ?? {};
    const actionConfig = asObject(body.action_config) ?? {};
    const conditions = Array.isArray(body.conditions) ? body.conditions : [];

    const inserted = await db.insert(automationRules).values({
      name,
      triggerType: triggerType as 'event' | 'schedule' | 'keyword',
      triggerConfig: JSON.stringify(triggerConfig),
      conditions: JSON.stringify(conditions),
      actionType: actionType as typeof automationRules.$inferInsert.actionType,
      actionConfig: JSON.stringify(actionConfig),
      accountSlot,
      enabled: body.enabled === false ? false : true,
    }).returning();

    return NextResponse.json({ ok: true, rule: parseRuleResponse(inserted[0]) }, { status: 201 });
  } catch (error) {
    console.error('Failed to create automation rule:', error);
    return NextResponse.json({ error: 'Failed to create automation rule.' }, { status: 500 });
  }
}
