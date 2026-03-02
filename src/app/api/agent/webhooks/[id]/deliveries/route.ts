import { NextResponse } from 'next/server';
import { sqlite } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const webhookId = Number(id);
    if (!Number.isFinite(webhookId)) {
      return NextResponse.json({ error: 'Invalid webhook ID.' }, { status: 400 });
    }

    const url = new URL(req.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);

    const countRow = sqlite
      .prepare(`SELECT COUNT(*) as total FROM webhook_deliveries WHERE webhook_id = ?`)
      .get(webhookId) as { total: number } | undefined;
    const total = countRow?.total ?? 0;

    const rows = sqlite
      .prepare(
        `SELECT * FROM webhook_deliveries
         WHERE webhook_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(webhookId, limit, offset) as Array<{
      id: number;
      webhook_id: number;
      event_id: number;
      status: string;
      attempts: number;
      last_attempt_at: number | null;
      response_status: number | null;
      response_body: string | null;
      created_at: number;
    }>;

    return NextResponse.json({
      deliveries: rows.map((r) => ({
        id: r.id,
        eventId: r.event_id,
        status: r.status,
        attempts: r.attempts,
        lastAttemptAt: r.last_attempt_at ? new Date(r.last_attempt_at * 1000).toISOString() : null,
        responseStatus: r.response_status,
        responseBody: r.response_body,
        createdAt: new Date(r.created_at * 1000).toISOString(),
      })),
      total,
      offset,
      limit,
      hasMore: offset + rows.length < total,
    });
  } catch (error) {
    console.error('Error fetching webhook deliveries:', error);
    return NextResponse.json({ error: 'Failed to fetch deliveries.' }, { status: 500 });
  }
}
