import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { mediaLibrary } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MEDIA_DIR = path.join(process.cwd(), 'public', 'uploads', 'library');

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mediaId = Number(id);
    if (!Number.isFinite(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID.' }, { status: 400 });
    }

    const [item] = await db.select().from(mediaLibrary).where(eq(mediaLibrary.id, mediaId)).limit(1);
    if (!item) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    return NextResponse.json({ ...item, url: `/uploads/library/${item.filename}` });
  } catch (error) {
    console.error('Error fetching media:', error);
    return NextResponse.json({ error: 'Failed to fetch media.' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mediaId = Number(id);
    if (!Number.isFinite(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID.' }, { status: 400 });
    }

    const [existing] = await db.select().from(mediaLibrary).where(eq(mediaLibrary.id, mediaId)).limit(1);
    if (!existing) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.tags !== undefined) {
      if (Array.isArray(body.tags)) {
        updates.tags = JSON.stringify(body.tags.filter((t: unknown) => typeof t === 'string'));
      } else if (body.tags === null) {
        updates.tags = null;
      }
    }

    if (body.description !== undefined) {
      updates.description = typeof body.description === 'string' ? body.description.trim() || null : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const [updated] = await db.update(mediaLibrary).set(updates).where(eq(mediaLibrary.id, mediaId)).returning();
    return NextResponse.json({ ...updated, url: `/uploads/library/${updated.filename}` });
  } catch (error) {
    console.error('Error updating media:', error);
    return NextResponse.json({ error: 'Failed to update media.' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mediaId = Number(id);
    if (!Number.isFinite(mediaId)) {
      return NextResponse.json({ error: 'Invalid media ID.' }, { status: 400 });
    }

    const [item] = await db.select().from(mediaLibrary).where(eq(mediaLibrary.id, mediaId)).limit(1);
    if (!item) {
      return NextResponse.json({ error: 'Media not found.' }, { status: 404 });
    }

    // Delete file from disk
    try {
      await fs.unlink(path.join(MEDIA_DIR, item.filename));
    } catch {
      // File may already be gone
    }

    await db.delete(mediaLibrary).where(eq(mediaLibrary.id, mediaId));
    return NextResponse.json({ ok: true, deleted: mediaId });
  } catch (error) {
    console.error('Error deleting media:', error);
    return NextResponse.json({ error: 'Failed to delete media.' }, { status: 500 });
  }
}
