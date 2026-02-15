import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTasks, campaigns } from '@/lib/db/schema';

type TaskBody = {
  task_type?: unknown;
  title?: unknown;
  details?: unknown;
  due_at?: unknown;
  priority?: unknown;
  assigned_agent?: unknown;
  status?: unknown;
};

const ALLOWED_TASK_TYPES = ['post', 'reply', 'dm', 'like', 'research', 'approval'] as const;
const ALLOWED_STATUSES = ['pending', 'in_progress', 'waiting_approval', 'done', 'failed', 'skipped'] as const;
type TaskType = (typeof ALLOWED_TASK_TYPES)[number];
type TaskStatus = (typeof ALLOWED_STATUSES)[number];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asPriority(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function asTaskType(value: unknown): TaskType | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_TASK_TYPES.includes(parsed as TaskType)) return null;
  return parsed as TaskType;
}

function asTaskStatus(value: unknown): TaskStatus | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_STATUSES.includes(parsed as TaskStatus)) return null;
  return parsed as TaskStatus;
}

function parseCampaignId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const campaignId = parseCampaignId(params.id);
  if (!campaignId) {
    return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
  }

  const rows = await db
    .select()
    .from(campaignTasks)
    .where(eq(campaignTasks.campaignId, campaignId))
    .orderBy(asc(campaignTasks.status), asc(campaignTasks.dueAt), asc(campaignTasks.id));

  return NextResponse.json({ items: rows });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const campaignId = parseCampaignId(params.id);
    if (!campaignId) {
      return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
    }

    const campaignRow = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    if (campaignRow.length === 0) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const body = (await req.json()) as TaskBody;
    const taskType = asTaskType(body.task_type);
    const title = asString(body.title);
    const details = asString(body.details);
    const dueAt = asDate(body.due_at);
    const priority = asPriority(body.priority);
    const assignedAgent = asString(body.assigned_agent);
    const statusRaw = asTaskStatus(body.status) ?? 'pending';

    if (!taskType) {
      return NextResponse.json({ error: 'Invalid task_type.' }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: 'title is required.' }, { status: 400 });
    }
    if (body.status !== undefined && !asTaskStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 });
    }

    const inserted = await db.insert(campaignTasks).values({
      campaignId,
      taskType,
      title,
      details,
      dueAt,
      priority,
      assignedAgent,
      status: statusRaw,
    }).returning();

    return NextResponse.json({ ok: true, task: inserted[0] });
  } catch (error) {
    console.error('Failed to create campaign task:', error);
    return NextResponse.json({ error: 'Failed to create campaign task.' }, { status: 500 });
  }
}
