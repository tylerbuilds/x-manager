import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feeds } from '@/lib/db/schema';
import { assertPublicUrl } from '@/lib/network-safety';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(id: string): number | null {
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const feedId = parseId(id);
    if (!feedId) return NextResponse.json({ error: 'Invalid feed id.' }, { status: 400 });

    const body = await req.json() as Record<string, unknown>;
    const updates: Partial<typeof feeds.$inferInsert> = { updatedAt: new Date() };
    if (typeof body.url === 'string' && body.url.trim()) {
      assertPublicUrl(body.url.trim());
      updates.url = body.url.trim();
    }
    if (typeof body.title === 'string') updates.title = body.title.trim();
    if (body.account_slot === 1 || body.account_slot === 2) updates.accountSlot = body.account_slot;
    if (body.check_interval_minutes != null) updates.checkIntervalMinutes = Math.max(5, Number(body.check_interval_minutes));
    if (body.auto_schedule === true || body.auto_schedule === false) updates.autoSchedule = body.auto_schedule;
    if (typeof body.template === 'string' || body.template === null) updates.template = body.template as string | null;
    if (body.status === 'active' || body.status === 'paused') updates.status = body.status;

    const updated = await db.update(feeds).set(updates).where(eq(feeds.id, feedId)).returning();
    if (!updated[0]) return NextResponse.json({ error: 'Feed not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, feed: updated[0] });
  } catch (error) {
    console.error('Failed to update feed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update feed.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const feedId = parseId(id);
    if (!feedId) return NextResponse.json({ error: 'Invalid feed id.' }, { status: 400 });

    const deleted = await db.delete(feeds).where(eq(feeds.id, feedId)).returning();
    if (!deleted[0]) return NextResponse.json({ error: 'Feed not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: deleted[0].id });
  } catch (error) {
    console.error('Failed to delete feed:', error);
    return NextResponse.json({ error: 'Failed to delete feed.' }, { status: 500 });
  }
}
