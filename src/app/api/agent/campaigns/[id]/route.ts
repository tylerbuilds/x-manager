import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaigns } from '@/lib/db/schema';
import { parseAccountSlot } from '@/lib/engagement-ops';

type CampaignUpdateBody = {
  name?: unknown;
  objective?: unknown;
  instructions?: unknown;
  account_slot?: unknown;
  start_at?: unknown;
  end_at?: unknown;
  status?: unknown;
};

const ALLOWED_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const;
type CampaignStatus = (typeof ALLOWED_STATUSES)[number];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asCampaignStatus(value: unknown): CampaignStatus | null {
  const parsed = asString(value);
  if (!parsed) return null;
  if (!ALLOWED_STATUSES.includes(parsed as CampaignStatus)) return null;
  return parsed as CampaignStatus;
}

function parseId(raw: string): number | null {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (!id) {
    return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
  }

  const rows = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  }

  return NextResponse.json({ campaign: row });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const id = parseId(params.id);
    if (!id) {
      return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
    }

    const body = (await req.json()) as CampaignUpdateBody;

    const updates: Partial<{
      name: string;
      objective: string;
      instructions: string | null;
      accountSlot: 1 | 2;
      startAt: Date | null;
      endAt: Date | null;
      status: CampaignStatus;
      updatedAt: Date;
    }> = {
      updatedAt: new Date(),
    };

    const name = asString(body.name);
    if (name) updates.name = name;

    const objective = asString(body.objective);
    if (objective) updates.objective = objective;

    if (body.instructions !== undefined) {
      updates.instructions = asString(body.instructions);
    }

    if (body.account_slot !== undefined) {
      updates.accountSlot = parseAccountSlot(body.account_slot);
    }

    if (body.start_at !== undefined) {
      updates.startAt = asDate(body.start_at);
    }

    if (body.end_at !== undefined) {
      updates.endAt = asDate(body.end_at);
    }

    if (body.status !== undefined) {
      const status = asCampaignStatus(body.status);
      if (!status) {
        return NextResponse.json({ error: 'Invalid status value.' }, { status: 400 });
      }
      updates.status = status;
    }

    const updated = await db.update(campaigns).set(updates).where(eq(campaigns.id, id)).returning();
    if (updated.length === 0) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, campaign: updated[0] });
  } catch (error) {
    console.error('Failed to update campaign:', error);
    return NextResponse.json({ error: 'Failed to update campaign.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const id = parseId(params.id);
  if (!id) {
    return NextResponse.json({ error: 'Invalid campaign id.' }, { status: 400 });
  }

  const updated = await db
    .update(campaigns)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();

  if (updated.length === 0) {
    return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, campaign: updated[0] });
}
