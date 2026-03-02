import { sqlite } from '@/lib/db';

export type EventType =
  | 'post.posted'
  | 'post.failed'
  | 'post.scheduled'
  | 'post.cancelled'
  | 'thread.completed'
  | 'thread.failed'
  | 'inbox.new_mention'
  | 'inbox.new_dm'
  | 'campaign.task_completed'
  | 'campaign.completed'
  | 'feed.new_entry'
  | 'keyword.match'
  | 'automation.executed'
  | 'automation.failed'
  | 'system.error';

export interface EmitEventOptions {
  eventType: EventType;
  entityType: string;
  entityId: string | number;
  payload?: Record<string, unknown>;
  accountSlot?: number;
}

const MAX_SSE_LISTENERS = 100;
type EventListener = (event: EmitEventOptions & { id: number; createdAt: number }) => void;
const sseListeners = new Set<EventListener>();
const internalListeners = new Set<EventListener>();

/**
 * Emit an event: persist to DB and notify in-process SSE listeners.
 */
export function emitEvent(options: EmitEventOptions): number {
  const { eventType, entityType, entityId, payload, accountSlot } = options;
  const result = sqlite
    .prepare(
      `INSERT INTO events (event_type, entity_type, entity_id, account_slot, payload, created_at)
       VALUES (?, ?, ?, ?, ?, unixepoch())`,
    )
    .run(
      eventType,
      entityType,
      String(entityId),
      accountSlot ?? null,
      payload ? JSON.stringify(payload) : null,
    );

  const id = Number(result.lastInsertRowid);
  const createdAt = Math.floor(Date.now() / 1000);
  const fullEvent = { ...options, id, createdAt };

  for (const listener of internalListeners) {
    try {
      listener(fullEvent);
    } catch {
      // Don't let a broken internal listener crash the emitter.
    }
  }
  for (const listener of sseListeners) {
    try {
      listener(fullEvent);
    } catch {
      // Don't let a broken SSE listener crash the emitter.
    }
  }

  return id;
}

/**
 * Register an internal listener (automation, webhooks) that is NEVER evicted.
 * Use this for system-critical consumers.
 */
export function onEventInternal(listener: EventListener): () => void {
  internalListeners.add(listener);
  return () => {
    internalListeners.delete(listener);
  };
}

/**
 * Register a listener for real-time SSE streaming.
 * Evicts oldest SSE listener when the cap is reached — internal listeners are never affected.
 * Returns an unsubscribe function.
 */
export function onEvent(listener: EventListener): () => void {
  if (sseListeners.size >= MAX_SSE_LISTENERS) {
    const oldest = sseListeners.values().next().value;
    if (oldest) sseListeners.delete(oldest);
  }
  sseListeners.add(listener);
  return () => {
    sseListeners.delete(listener);
  };
}

/**
 * Query persisted events with optional filters.
 */
export function queryEvents(options: {
  eventType?: string;
  entityType?: string;
  accountSlot?: number;
  since?: number; // unix timestamp
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}): { events: EventRow[]; total: number } {
  const { eventType, entityType, accountSlot, since, unreadOnly, limit = 50, offset = 0 } = options;

  const where: string[] = ['1=1'];
  const params: unknown[] = [];

  if (eventType) {
    where.push('event_type = ?');
    params.push(eventType);
  }
  if (entityType) {
    where.push('entity_type = ?');
    params.push(entityType);
  }
  if (accountSlot != null) {
    where.push('account_slot = ?');
    params.push(accountSlot);
  }
  if (since != null) {
    where.push('created_at >= ?');
    params.push(since);
  }
  if (unreadOnly) {
    where.push('read_at IS NULL');
  }

  const whereSQL = where.join(' AND ');

  const countRow = sqlite
    .prepare(`SELECT COUNT(*) as total FROM events WHERE ${whereSQL}`)
    .get(...params) as { total: number } | undefined;
  const total = countRow?.total ?? 0;

  const rows = sqlite
    .prepare(
      `SELECT * FROM events WHERE ${whereSQL} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as EventRow[];

  return { events: rows, total };
}

export interface EventRow {
  id: number;
  event_type: string;
  entity_type: string;
  entity_id: string;
  account_slot: number | null;
  payload: string | null;
  read_at: number | null;
  created_at: number;
}
