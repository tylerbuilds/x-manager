import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { scheduledPosts, postApprovals } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const postId = Number.parseInt(id, 10);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'Invalid post id.' }, { status: 400 });
    }

    const existingPost = await db.select().from(scheduledPosts).where(eq(scheduledPosts.id, postId)).limit(1);
    if (existingPost.length === 0) {
      return NextResponse.json({ error: 'Post not found.' }, { status: 404 });
    }

    if (existingPost[0].status !== 'scheduled') {
      return NextResponse.json(
        { error: `Post must be in 'scheduled' status to request approval. Current status: ${existingPost[0].status}` },
        { status: 409 },
      );
    }

    let requestedBy = 'user';
    try {
      const body = await req.json() as Record<string, unknown>;
      if (typeof body.requested_by === 'string' && body.requested_by.trim()) {
        requestedBy = body.requested_by.trim();
      }
    } catch {
      // Body is optional — ignore parse errors
    }

    const inserted = await db
      .insert(postApprovals)
      .values({
        postId,
        requestedBy,
        status: 'pending',
      })
      .returning();

    // SQLite text columns accept any value at runtime even if Drizzle enum
    // does not include 'pending_approval'.
    await db
      .update(scheduledPosts)
      .set({ status: 'pending_approval' as 'scheduled', updatedAt: new Date() })
      .where(eq(scheduledPosts.id, postId));

    return NextResponse.json({ ok: true, approval: inserted[0] });
  } catch (error) {
    console.error(`Error requesting approval for post ${id}:`, error);
    return NextResponse.json({ error: 'Failed to request approval.' }, { status: 500 });
  }
}
