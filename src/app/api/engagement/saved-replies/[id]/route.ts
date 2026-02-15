import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { savedReplies } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid ID.' }, { status: 400 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.text !== undefined) updates.text = body.text.trim();
    if (body.category !== undefined) updates.category = body.category?.trim() || null;
    if (body.shortcut !== undefined) updates.shortcut = body.shortcut?.trim() || null;
    if (body.incrementUseCount) {
      // Increment use count
      const existing = await db.select().from(savedReplies).where(eq(savedReplies.id, id)).limit(1);
      if (existing.length > 0) {
        updates.useCount = (existing[0].useCount || 0) + 1;
      }
    }

    await db.update(savedReplies).set(updates).where(eq(savedReplies.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update saved reply:', error);
    return NextResponse.json({ error: 'Failed to update saved reply.' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid ID.' }, { status: 400 });
    }

    await db.delete(savedReplies).where(eq(savedReplies.id, id));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete saved reply:', error);
    return NextResponse.json({ error: 'Failed to delete saved reply.' }, { status: 500 });
  }
}
