import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  try {
    const body = await req.json();

    // Support single or bulk reschedule
    const items: Array<{ postId: number; newScheduledTime: string }> = Array.isArray(body)
      ? body
      : body.postId && body.newScheduledTime
        ? [body]
        : [];

    if (items.length === 0) {
      return NextResponse.json({ error: 'Provide postId and newScheduledTime.' }, { status: 400 });
    }

    const results: Array<{ postId: number; success: boolean; error?: string }> = [];

    for (const item of items) {
      const { postId, newScheduledTime } = item;

      if (!postId || !newScheduledTime) {
        results.push({ postId, success: false, error: 'Missing postId or newScheduledTime.' });
        continue;
      }

      const parsed = new Date(newScheduledTime);
      if (Number.isNaN(parsed.getTime())) {
        results.push({ postId, success: false, error: 'Invalid date format.' });
        continue;
      }

      // Only allow rescheduling posts that are still 'scheduled'
      const existing = await db
        .select()
        .from(scheduledPosts)
        .where(eq(scheduledPosts.id, postId))
        .limit(1);

      if (existing.length === 0) {
        results.push({ postId, success: false, error: 'Post not found.' });
        continue;
      }

      if (existing[0].status !== 'scheduled') {
        results.push({ postId, success: false, error: `Cannot reschedule a ${existing[0].status} post.` });
        continue;
      }

      await db
        .update(scheduledPosts)
        .set({
          scheduledTime: parsed,
          updatedAt: new Date(),
        })
        .where(eq(scheduledPosts.id, postId));

      results.push({ postId, success: true });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Reschedule error:', error);
    return NextResponse.json({ error: 'Failed to reschedule posts.' }, { status: 500 });
  }
}
