import { onEvent } from '@/lib/events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const eventTypeFilter = url.searchParams.get('event_type') || null;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      // Keep-alive every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 30_000);

      // Subscribe FIRST — capture unsubscribe synchronously before abort can fire
      const unsubscribe = onEvent((event) => {
        if (eventTypeFilter && event.eventType !== eventTypeFilter) return;

        try {
          const data = JSON.stringify({
            id: event.id,
            eventType: event.eventType,
            entityType: event.entityType,
            entityId: String(event.entityId),
            accountSlot: event.accountSlot ?? null,
            payload: event.payload ?? null,
            createdAt: new Date(event.createdAt * 1000).toISOString(),
          });
          controller.enqueue(encoder.encode(`id: ${event.id}\ndata: ${data}\n\n`));
        } catch {
          // Client disconnected
          clearInterval(keepAlive);
          unsubscribe();
        }
      });

      // Cleanup function shared by abort + cancel
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        clearInterval(keepAlive);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      // Handle abort (client disconnect)
      req.signal.addEventListener('abort', cleanup);

      // Also handle cancel
      // Store cleanup ref on controller for the cancel() callback
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel(controller) {
      const ctrl = controller as unknown as { _cleanup?: () => void };
      if (ctrl?._cleanup) ctrl._cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
