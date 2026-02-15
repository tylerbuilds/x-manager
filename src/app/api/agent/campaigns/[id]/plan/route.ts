import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaignTasks, campaigns } from '@/lib/db/schema';
import { buildDefaultCampaignPlan } from '@/lib/campaign-planner';

type PlanBody = {
  save?: unknown;
};

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseCampaignId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const campaignId = parseCampaignId(params.id);
    if (!campaignId) {
      return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
    }

    let body: PlanBody = {};
    try {
      body = (await req.json()) as PlanBody;
    } catch {
      body = {};
    }

    const campaignRows = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    const campaign = campaignRows[0];
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const plan = buildDefaultCampaignPlan({
      objective: campaign.objective,
      instructions: campaign.instructions,
      startAt: campaign.startAt,
      endAt: campaign.endAt,
    });

    const save = asBool(body.save, false);
    let insertedCount = 0;

    if (save) {
      const values = plan.map((task) => ({
        campaignId,
        taskType: task.taskType,
        title: task.title,
        details: task.details,
        dueAt: task.dueAt,
        priority: task.priority,
        status: task.status,
      }));
      const inserted = await db.insert(campaignTasks).values(values).returning({ id: campaignTasks.id });
      insertedCount = inserted.length;
    }

    return NextResponse.json({
      ok: true,
      campaignId,
      saved: save,
      insertedCount,
      plan,
    });
  } catch (error) {
    console.error('Failed to generate campaign plan:', error);
    return NextResponse.json({ error: 'Failed to generate campaign plan.' }, { status: 500 });
  }
}
