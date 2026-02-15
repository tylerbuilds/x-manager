import { NextResponse } from 'next/server';
import { executeCampaign } from '@/lib/task-executor';
import { withIdempotency } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const campaignId = Number.parseInt(params.id, 10);
  if (!Number.isFinite(campaignId) || campaignId <= 0) {
    return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
  }

  return withIdempotency(`campaign-execute-${campaignId}`, req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        max_tasks?: number;
        dry_run?: boolean;
        only_types?: string[];
        until?: string;
        actor?: string;
      };

      const result = await executeCampaign(campaignId, {
        maxTasks: typeof body.max_tasks === 'number' ? body.max_tasks : undefined,
        dryRun: body.dry_run === true,
        onlyTypes: Array.isArray(body.only_types) ? body.only_types : undefined,
        until: typeof body.until === 'string' ? new Date(body.until) : undefined,
        actor: typeof body.actor === 'string' ? body.actor : undefined,
      });

      return NextResponse.json({ ok: true, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to execute campaign.';
      console.error(`Failed to execute campaign ${campaignId}:`, error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}
