import { desc } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeds } from '@/lib/db/schema';
import { assertPublicUrl } from '@/lib/network-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.select().from(feeds).orderBy(desc(feeds.createdAt));
    return NextResponse.json({ feeds: rows });
  } catch (error) {
    console.error('Failed to list feeds:', error);
    return NextResponse.json({ error: 'Failed to list feeds.' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const url = typeof body.url === 'string' ? body.url.trim() : '';
    const accountSlot = Number(body.account_slot ?? 1);
    if (!url) {
      return NextResponse.json({ error: 'url is required.' }, { status: 400 });
    }
    if (accountSlot !== 1 && accountSlot !== 2) {
      return NextResponse.json({ error: 'account_slot must be 1 or 2.' }, { status: 400 });
    }

    assertPublicUrl(url);

    const inserted = await db.insert(feeds).values({
      url,
      title: typeof body.title === 'string' ? body.title.trim() : null,
      accountSlot,
      checkIntervalMinutes: Math.max(5, Number(body.check_interval_minutes ?? 15)),
      autoSchedule: body.auto_schedule === true,
      template: typeof body.template === 'string' ? body.template : null,
      status: body.status === 'paused' ? 'paused' : 'active',
    }).returning();

    return NextResponse.json({ ok: true, feed: inserted[0] }, { status: 201 });
  } catch (error) {
    console.error('Failed to create feed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create feed.' }, { status: 500 });
  }
}
