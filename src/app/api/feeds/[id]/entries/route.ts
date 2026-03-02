import { and, count, desc, eq, isNotNull } from 'drizzle-orm';
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
    // S11 fix: Add limit + offset pagination
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const conditions = [eq(feedEntries.feedId, feedId)];
    if (scheduledOnly) {
      conditions.push(isNotNull(feedEntries.scheduledPostId));
    }

    const where = conditions.length === 1 ? conditions[0] : and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(feedEntries)
        .where(where)
        .orderBy(desc(feedEntries.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(feedEntries)
        .where(where),
    ]);

    return NextResponse.json({
      entries: rows,
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Failed to list feed entries:', error);
    return NextResponse.json({ error: 'Failed to list feed entries.' }, { status: 500 });
  }
}
