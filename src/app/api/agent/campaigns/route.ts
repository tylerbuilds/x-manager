import { and, desc, eq, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { campaigns } from '@/lib/db/schema';
import { parseAccountSlot } from '@/lib/engagement-ops';

type CampaignCreateBody = {
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const statusParam = asString(url.searchParams.get('status'));
    const slotFilter = asString(url.searchParams.get('account_slot'));

    const conditions: SQL[] = [];
    if (statusParam) {
      const statusFilter = asCampaignStatus(statusParam);
      if (!statusFilter) {
        return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 });
      }
      conditions.push(eq(campaigns.status, statusFilter));
    }
    if (slotFilter) {
      const slot = parseAccountSlot(slotFilter);
      conditions.push(eq(campaigns.accountSlot, slot));
    }

    const rows = conditions.length > 0
      ? await db.select().from(campaigns).where(and(...conditions)).orderBy(desc(campaigns.createdAt))
      : await db.select().from(campaigns).orderBy(desc(campaigns.createdAt));

    return NextResponse.json({ items: rows });
  } catch (error) {
    console.error('Failed to list campaigns:', error);
    return NextResponse.json({ error: 'Failed to list campaigns.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as CampaignCreateBody;
    const name = asString(body.name);
    const objective = asString(body.objective);
    const instructions = asString(body.instructions);
    const accountSlot = parseAccountSlot(body.account_slot ?? 1);
    const startAt = asDate(body.start_at);
    const endAt = asDate(body.end_at);
    const status = asCampaignStatus(body.status) ?? 'draft';

    if (!name || !objective) {
      return NextResponse.json({ error: 'name and objective are required.' }, { status: 400 });
    }
    if (body.status !== undefined && !asCampaignStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status value.' }, { status: 400 });
    }

    const inserted = await db.insert(campaigns).values({
      name,
      objective,
      instructions,
      accountSlot,
      startAt,
      endAt,
      status,
    }).returning();

    return NextResponse.json({ ok: true, campaign: inserted[0] });
  } catch (error) {
    console.error('Failed to create campaign:', error);
    return NextResponse.json({ error: 'Failed to create campaign.' }, { status: 500 });
  }
}
