import { NextResponse } from 'next/server';
import { executeTask } from '@/lib/task-executor';
import { withIdempotency } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const taskId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(taskId) || taskId <= 0) {
    return NextResponse.json({ error: 'Invalid task id.' }, { status: 400 });
  }

  return withIdempotency(`task-execute-${taskId}`, req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        dry_run?: boolean;
        idempotency_key?: string;
        actor?: string;
      };

      const result = await executeTask(taskId, {
        dryRun: body.dry_run === true,
        actor: typeof body.actor === 'string' ? body.actor : undefined,
      });

      return NextResponse.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute task.';
      console.error(`Failed to execute task ${taskId}:`, error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
