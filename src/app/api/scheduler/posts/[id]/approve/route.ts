import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/lib/db';
import { scheduledPosts, postApprovals } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const postId = Number.parseInt(id, 10);
    if (!Number.isFinite(postId) || postId <= 0) {
      return NextResponse.json({ error: 'Invalid post id.' }, { status: 400 });
    }

    const body = await req.json() as Record<string, unknown>;

    const decision = body.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return NextResponse.json(
        { error: "decision is required and must be 'approved' or 'rejected'." },
        { status: 400 },
      );
    }

    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

    const pendingApprovals = await db
      .select()
      .from(postApprovals)
      .where(and(eq(postApprovals.postId, postId), eq(postApprovals.status, 'pending')))
      .limit(1);

    if (pendingApprovals.length === 0) {
      return NextResponse.json({ error: 'No pending approval found for this post.' }, { status: 404 });
    }

    const approval = pendingApprovals[0];

    const updatedApproval = await db
      .update(postApprovals)
      .set({
        status: decision,
        decisionNote: note,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(postApprovals.id, approval.id))
      .returning();

    // Restore to 'scheduled' if approved, cancel if rejected
    const newPostStatus = decision === 'approved' ? 'scheduled' : 'cancelled';
    await db
      .update(scheduledPosts)
      .set({ status: newPostStatus, updatedAt: new Date() })
      .where(eq(scheduledPosts.id, postId));

    return NextResponse.json({ ok: true, approval: updatedApproval[0], postStatus: newPostStatus });
  } catch (error) {
    console.error(`Error processing approval decision for post ${id}:`, error);
    return NextResponse.json({ error: 'Failed to process approval decision.' }, { status: 500 });
  }
}
