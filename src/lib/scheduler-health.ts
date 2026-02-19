/**
 * Scheduler health tracking — exposes liveness state for the readiness
 * endpoint and external monitors.  All state is in-process (globalThis)
 * so it survives Next.js hot-reloads in dev mode.
 */

interface SchedulerHealth {
  startedAt: string | null;
  lastCycleAt: string | null;
  lastCycleResult: 'ok' | 'error' | null;
  consecutiveErrors: number;
}

const KEY = '__xManagerSchedulerHealth' as const;

function get(): SchedulerHealth {
  const g = globalThis as Record<string, unknown>;
  if (!g[KEY]) {
    g[KEY] = {
      startedAt: null,
      lastCycleAt: null,
      lastCycleResult: null,
      consecutiveErrors: 0,
    };
  }
  return g[KEY] as SchedulerHealth;
}

export function markSchedulerStarted(): void {
  get().startedAt = new Date().toISOString();
}

export function markCycleSuccess(): void {
  const h = get();
  h.lastCycleAt = new Date().toISOString();
  h.lastCycleResult = 'ok';
  h.consecutiveErrors = 0;
}

export function markCycleError(): void {
  const h = get();
  h.lastCycleAt = new Date().toISOString();
  h.lastCycleResult = 'error';
  h.consecutiveErrors += 1;
}

export function getSchedulerHealth(): SchedulerHealth {
  return { ...get() };
}
