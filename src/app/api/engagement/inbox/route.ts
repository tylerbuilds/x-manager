import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { engagementInbox } from '@/lib/db/schema';
import { parseAccountSlot } from '@/lib/engagement-ops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_TYPES = ['mention', 'dm'] as const;
const ALLOWED_STATUSES = ['new', 'reviewed', 'replied', 'dismissed'] as const;
type InboxType = (typeof ALLOWED_TYPES)[number];
type InboxStatus = (typeof ALLOWED_STATUSES)[number];

function parseLimit(value: string | null): number {
  const parsed = Number(value || 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function asInboxType(value: string | null): InboxType | null {
  if (!value) return null;
  const parsed = value.trim();
  if (!parsed) return null;
  if (!ALLOWED_TYPES.includes(parsed as InboxType)) return null;
  return parsed as InboxType;
}

function parseInboxStatuses(value: string | null): InboxStatus[] | null {
  if (!value) return null;
  const statuses = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (statuses.length === 0) return [];
  if (statuses.some((status) => !ALLOWED_STATUSES.includes(status as InboxStatus))) {
    return null;
  }
  return statuses as InboxStatus[];
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    const typeParam = url.searchParams.get('type');
    const statusParam = url.searchParams.get('status');

    const limit = parseLimit(url.searchParams.get('limit'));

    const conditions: SQL[] = [];
    if (slotParam) {
      const slot = parseAccountSlot(slotParam);
      conditions.push(eq(engagementInbox.accountSlot, slot));
    }

    if (typeParam) {
      const type = asInboxType(typeParam);
      if (!type) {
        return NextResponse.json({ error: 'Invalid type. Use mention or dm.' }, { status: 400 });
      }
      conditions.push(eq(engagementInbox.sourceType, type));
    }

    if (statusParam) {
      const statuses = parseInboxStatuses(statusParam);
      if (statuses === null) {
        return NextResponse.json({ error: 'Invalid status filter.' }, { status: 400 });
      }
      if (statuses.length > 0) {
        conditions.push(inArray(engagementInbox.status, statuses));
      }
    }

    const rows = conditions.length > 0
      ? await db
          .select()
          .from(engagementInbox)
          .where(and(...conditions))
          .orderBy(desc(engagementInbox.receivedAt))
          .limit(limit)
      : await db
          .select()
          .from(engagementInbox)
          .orderBy(desc(engagementInbox.receivedAt))
          .limit(limit);

    return NextResponse.json({
      items: rows.map((row) => ({
        ...row,
        rawPayload: (() => {
          try {
            return JSON.parse(row.rawPayload);
          } catch {
            return row.rawPayload;
          }
        })(),
      })),
    });
  } catch (error) {
    console.error('Failed to list engagement inbox items:', error);
    return NextResponse.json({ error: 'Failed to list engagement inbox items.' }, { status: 500 });
  }
}
