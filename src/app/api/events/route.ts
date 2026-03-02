import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';
import { queryEvents } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const eventType = url.searchParams.get('event_type') || undefined;
    const entityType = url.searchParams.get('entity_type') || undefined;
    const accountSlot = url.searchParams.get('account_slot')
      ? Number(url.searchParams.get('account_slot'))
      : undefined;
    const since = url.searchParams.get('since')
      ? Math.floor(new Date(url.searchParams.get('since')!).getTime() / 1000)
      : undefined;
    const unreadOnly = url.searchParams.get('unread') === 'true';
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const { events, total } = queryEvents({
      eventType,
      entityType,
      accountSlot,
      since,
      unreadOnly,
      limit,
      offset,
    });

    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.event_type,
        entityType: e.entity_type,
        entityId: e.entity_id,
        accountSlot: e.account_slot,
        payload: e.payload ? JSON.parse(e.payload) : null,
        read: e.read_at !== null,
        createdAt: new Date(e.created_at * 1000).toISOString(),
      })),
      total,
      offset,
      limit,
      hasMore: offset + events.length < total,
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json({ error: 'Failed to fetch events.' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const olderThanDays = Number(url.searchParams.get('older_than_days') || 30);
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 86400;

    const result = sqlite
      .prepare(`DELETE FROM events WHERE created_at < ?`)
      .run(cutoff);

    return NextResponse.json({ deleted: result.changes });
  } catch (error) {
    console.error('Error clearing events:', error);
    return NextResponse.json({ error: 'Failed to clear events.' }, { status: 500 });
  }
}
