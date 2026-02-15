import { NextResponse } from 'next/server';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db';
import { scheduledPosts } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { postIds, action, scheduledTime } = body;

    if (!Array.isArray(postIds) || postIds.length === 0) {
      return NextResponse.json({ error: 'postIds array is required.' }, { status: 400 });
    }

    const ids = postIds.map(Number).filter(Number.isFinite);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'No valid IDs provided.' }, { status: 400 });
    }

    let affected = 0;

    switch (action) {
      case 'cancel': {
        const result = await db
          .update(scheduledPosts)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(inArray(scheduledPosts.id, ids));
        affected = result.changes ?? ids.length;
        break;
      }
      case 'delete': {
        const result = await db
          .delete(scheduledPosts)
          .where(inArray(scheduledPosts.id, ids));
        affected = result.changes ?? ids.length;
        break;
      }
      case 'reschedule': {
        if (!scheduledTime) {
          return NextResponse.json({ error: 'scheduledTime required for reschedule.' }, { status: 400 });
        }
        const newTime = new Date(scheduledTime);
        if (Number.isNaN(newTime.getTime())) {
          return NextResponse.json({ error: 'Invalid scheduledTime.' }, { status: 400 });
        }
        if (newTime < new Date()) {
          return NextResponse.json({ error: 'Cannot schedule in the past.' }, { status: 400 });
        }
        const result = await db
          .update(scheduledPosts)
          .set({ scheduledTime: newTime, updatedAt: new Date() })
          .where(inArray(scheduledPosts.id, ids));
        affected = result.changes ?? ids.length;
        break;
      }
      default:
        return NextResponse.json({ error: 'Invalid action. Use cancel, delete, or reschedule.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, action, affected });
  } catch (error) {
    console.error('Bulk operation failed:', error);
    return NextResponse.json({ error: 'Bulk operation failed.' }, { status: 500 });
  }
}
