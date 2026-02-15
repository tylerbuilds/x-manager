import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTasks } from '@/lib/db/schema';

type TaskPatchBody = {
  status?: unknown;
  title?: unknown;
  details?: unknown;
  due_at?: unknown;
  priority?: unknown;
  assigned_agent?: unknown;
  output?: unknown;
};

const ALLOWED_STATUSES = ['pending', 'in_progress', 'waiting_approval', 'done', 'failed', 'skipped'] as const;
type TaskStatus = (typeof ALLOWED_STATUSES)[number];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asPriority(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(1, Math.min(3, Math.floor(parsed)));
}

function asTaskStatus(value: unknown): TaskStatus | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_STATUSES.includes(parsed as TaskStatus)) return null;
  return parsed as TaskStatus;
}

function parseTaskId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const taskId = parseTaskId(params.id);
    if (!taskId) {
      return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
    }

    const body = (await req.json()) as TaskPatchBody;
    const updates: Partial<{
      status: TaskStatus;
      title: string;
      details: string | null;
      dueAt: Date | null;
      priority: number;
      assignedAgent: string | null;
      output: string | null;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (body.status !== undefined) {
      const status = asTaskStatus(body.status);
      if (!status) {
        return NextResponse.json({ error: 'Invalid status value.' }, { status: 400 });
      }
      updates.status = status;
    }

    if (body.title !== undefined) {
      const title = asString(body.title);
      if (!title) {
        return NextResponse.json({ error: 'title cannot be empty.' }, { status: 400 });
      }
      updates.title = title;
    }

    if (body.details !== undefined) {
      updates.details = asString(body.details);
    }

    if (body.due_at !== undefined) {
      updates.dueAt = asDate(body.due_at);
    }

    if (body.priority !== undefined) {
      const priority = asPriority(body.priority);
      if (priority === null) {
        return NextResponse.json({ error: 'Invalid priority value.' }, { status: 400 });
      }
      updates.priority = priority;
    }

    if (body.assigned_agent !== undefined) {
      updates.assignedAgent = asString(body.assigned_agent);
    }

    if (body.output !== undefined) {
      updates.output = body.output === null ? null : JSON.stringify(body.output);
    }

    const updated = await db.update(campaignTasks).set(updates).where(eq(campaignTasks.id, taskId)).returning();
    if (updated.length === 0) {
      return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, task: updated[0] });
  } catch (error) {
    console.error('Failed to update campaign task:', error);
    return NextResponse.json({ error: 'Failed to update campaign task.' }, { status: 500 });
  }
}
