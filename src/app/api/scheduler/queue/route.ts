import { NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contentQueue } from '@/lib/db/schema';
import { isAccountSlot, parseAccountSlot, type AccountSlot } from '@/lib/account-slots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const slotParam = url.searchParams.get('account_slot');
    let slot: AccountSlot | null = null;

    if (slotParam) {
      const parsed = Number(slotParam);
      if (!Number.isFinite(parsed) || !isAccountSlot(parsed)) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      slot = parsed;
    }

    const conditions = slot
      ? and(eq(contentQueue.accountSlot, slot), eq(contentQueue.status, 'queued'))
      : eq(contentQueue.status, 'queued');

    const items = await db
      .select()
      .from(contentQueue)
      .where(conditions)
      .orderBy(asc(contentQueue.position));

    return NextResponse.json({ items });
  } catch (error) {
    console.error('Failed to list queue:', error);
    return NextResponse.json({ error: 'Failed to list queue.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { text, mediaUrls, communityId, accountSlot: slotRaw } = body;

    if (!text?.trim()) {
      return NextResponse.json({ error: 'Text is required.' }, { status: 400 });
    }

    let accountSlot: AccountSlot = 1;
    if (slotRaw !== undefined) {
      const parsed = parseAccountSlot(slotRaw);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid account_slot. Use 1 or 2.' }, { status: 400 });
      }
      accountSlot = parsed;
    }

    // Get next position
    const existing = await db
      .select()
      .from(contentQueue)
      .where(
        and(
          eq(contentQueue.accountSlot, accountSlot),
          eq(contentQueue.status, 'queued'),
        ),
      )
      .orderBy(asc(contentQueue.position));

    const nextPosition = existing.length > 0
      ? Math.max(...existing.map((e) => e.position)) + 1
      : 0;

    const inserted = await db.insert(contentQueue).values({
      accountSlot,
      text: text.trim(),
      mediaUrls: mediaUrls ? JSON.stringify(mediaUrls) : null,
      communityId: communityId?.trim() || null,
      position: nextPosition,
    }).returning();

    return NextResponse.json({ item: inserted[0] });
  } catch (error) {
    console.error('Failed to add to queue:', error);
    return NextResponse.json({ error: 'Failed to add to queue.' }, { status: 500 });
  }
}
