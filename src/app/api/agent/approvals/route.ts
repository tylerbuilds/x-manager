import { and, desc, eq, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignApprovals } from '@/lib/db/schema';

type ApprovalBody = {
  id?: unknown;
  campaign_id?: unknown;
  task_id?: unknown;
  requested_by?: unknown;
  status?: unknown;
  decision_note?: unknown;
};

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected'] as const;
type ApprovalStatus = (typeof ALLOWED_STATUSES)[number];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asApprovalStatus(value: unknown): ApprovalStatus | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_STATUSES.includes(parsed as ApprovalStatus)) return null;
  return parsed as ApprovalStatus;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const campaignId = asInt(url.searchParams.get('campaign_id'));
    const statusParam = asString(url.searchParams.get('status'));

    const conditions: SQL[] = [];
    if (campaignId) conditions.push(eq(campaignApprovals.campaignId, campaignId));
    if (statusParam) {
      const status = asApprovalStatus(statusParam);
      if (!status) {
        return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 });
      }
      conditions.push(eq(campaignApprovals.status, status));
    }

    const rows = conditions.length > 0
      ? await db.select().from(campaignApprovals).where(and(...conditions)).orderBy(desc(campaignApprovals.requestedAt))
      : await db.select().from(campaignApprovals).orderBy(desc(campaignApprovals.requestedAt));

    return NextResponse.json({ items: rows });
  } catch (error) {
    console.error('Failed to list approvals:', error);
    return NextResponse.json({ error: 'Failed to list approvals.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ApprovalBody;
    const campaignId = asInt(body.campaign_id);
    const taskId = asInt(body.task_id);
    const requestedBy = asString(body.requested_by) || 'agent';

    if (!campaignId) {
      return NextResponse.json({ error: 'campaign_id is required.' }, { status: 400 });
    }

    const inserted = await db.insert(campaignApprovals).values({
      campaignId,
      taskId,
      requestedBy,
      status: 'pending',
      requestedAt: new Date(),
    }).returning();

    return NextResponse.json({ ok: true, approval: inserted[0] });
  } catch (error) {
    console.error('Failed to create approval:', error);
    return NextResponse.json({ error: 'Failed to create approval.' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as ApprovalBody;
    const id = asInt(body.id);
    const status = asApprovalStatus(body.status);
    const decisionNote = asString(body.decision_note);

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }
    if (!status) {
      return NextResponse.json({ error: 'Invalid status value.' }, { status: 400 });
    }

    const updated = await db
      .update(campaignApprovals)
      .set({
        status,
        decisionNote,
        decidedAt: status === 'pending' ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaignApprovals.id, id))
      .returning();

    if (updated.length === 0) {
      return NextResponse.json({ error: 'Approval not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, approval: updated[0] });
  } catch (error) {
    console.error('Failed to update approval:', error);
    return NextResponse.json({ error: 'Failed to update approval.' }, { status: 500 });
  }
}
