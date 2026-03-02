import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { feedEntries } from '@/lib/db/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const feedId = Number.parseInt(id, 10);
    if (!Number.isFinite(feedId) || feedId <= 0) {
      return NextResponse.json({ error: 'Invalid feed id.' }, { status: 400 });
    }

    const url = new URL(req.url);
    const scheduledOnly = url.searchParams.get('scheduled') === 'true';
    const conditions = [eq(feedEntries.feedId, feedId)];
    if (scheduledOnly) {
      conditions.push(isNotNull(feedEntries.scheduledPostId));
    }

    const rows = await db
      .select()
      .from(feedEntries)
      .where(conditions.length === 1 ? conditions[0] : and(...conditions))
      .orderBy(desc(feedEntries.createdAt));

    return NextResponse.json({ entries: rows });
  } catch (error) {
    console.error('Failed to list feed entries:', error);
    return NextResponse.json({ error: 'Failed to list feed entries.' }, { status: 500 });
  }
}
