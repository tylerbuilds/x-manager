import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contentQueue } from '@/lib/db/schema';

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

    if (body.text !== undefined) updates.text = body.text.trim();
    if (body.mediaUrls !== undefined) updates.mediaUrls = JSON.stringify(body.mediaUrls);
    if (body.communityId !== undefined) updates.communityId = body.communityId?.trim() || null;
    if (body.position !== undefined) {
      const pos = Number(body.position);
      if (!Number.isFinite(pos) || pos < 0) {
        return NextResponse.json({ error: 'Invalid position.' }, { status: 400 });
      }
      updates.position = pos;
    }

    await db.update(contentQueue).set(updates).where(
      and(eq(contentQueue.id, id), eq(contentQueue.status, 'queued')),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to update queue item:', error);
    return NextResponse.json({ error: 'Failed to update queue item.' }, { status: 500 });
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

    await db.update(contentQueue).set({
      status: 'cancelled',
      updatedAt: new Date(),
    }).where(eq(contentQueue.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to remove queue item:', error);
    return NextResponse.json({ error: 'Failed to remove queue item.' }, { status: 500 });
  }
}
