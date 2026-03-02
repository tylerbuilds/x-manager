import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const eventId = Number(id);
    if (!Number.isFinite(eventId)) {
      return NextResponse.json({ error: 'Invalid event ID.' }, { status: 400 });
    }

    const result = sqlite
      .prepare(`UPDATE events SET read_at = unixepoch() WHERE id = ? AND read_at IS NULL`)
      .run(eventId);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Event not found or already read.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, id: eventId });
  } catch (error) {
    console.error('Error marking event read:', error);
    return NextResponse.json({ error: 'Failed to update event.' }, { status: 500 });
  }
}
