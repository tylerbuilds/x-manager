import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { savedSearches } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseId(id: string): number | null {
  const parsed = Number.parseInt(id, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function serializeSearch(search: typeof savedSearches.$inferSelect) {
  return {
    ...search,
    keywords: JSON.parse(search.keywords),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const searchId = parseId(id);
    if (!searchId) return NextResponse.json({ error: 'Invalid saved search id.' }, { status: 400 });

    const body = await req.json() as Record<string, unknown>;
    const updates: Partial<typeof savedSearches.$inferInsert> = { updatedAt: new Date() };
    if (Array.isArray(body.keywords)) updates.keywords = JSON.stringify(body.keywords.map((value) => String(value).trim()).filter(Boolean));
    if (body.account_slot === 1 || body.account_slot === 2) updates.accountSlot = body.account_slot;
    if (body.check_interval_minutes != null) updates.checkIntervalMinutes = Math.max(5, Number(body.check_interval_minutes));
    if (body.auto_action === 'like' || body.auto_action === 'reply' || body.auto_action === null) updates.autoAction = body.auto_action as 'like' | 'reply' | null;
    if (typeof body.reply_template === 'string' || body.reply_template === null) updates.replyTemplate = body.reply_template as string | null;
    if (body.notify === true || body.notify === false) updates.notify = body.notify;
    if (typeof body.language === 'string') updates.language = body.language.trim() || 'en';
    if (body.status === 'active' || body.status === 'paused') updates.status = body.status;

    const updated = await db.update(savedSearches).set(updates).where(eq(savedSearches.id, searchId)).returning();
    if (!updated[0]) return NextResponse.json({ error: 'Saved search not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, search: serializeSearch(updated[0]) });
  } catch (error) {
    console.error('Failed to update saved search:', error);
    return NextResponse.json({ error: 'Failed to update saved search.' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const searchId = parseId(id);
    if (!searchId) return NextResponse.json({ error: 'Invalid saved search id.' }, { status: 400 });

    const deleted = await db.delete(savedSearches).where(eq(savedSearches.id, searchId)).returning();
    if (!deleted[0]) return NextResponse.json({ error: 'Saved search not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, deleted: deleted[0].id });
  } catch (error) {
    console.error('Failed to delete saved search:', error);
    return NextResponse.json({ error: 'Failed to delete saved search.' }, { status: 500 });
  }
}
