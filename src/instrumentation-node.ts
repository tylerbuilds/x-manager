import { runBootChecks } from './lib/boot-checks';

const STARTUP_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startWithRetry(name: string, fn: () => void | Promise<void>): Promise<void> {
  for (let attempt = 1; attempt <= STARTUP_RETRIES; attempt += 1) {
    try {
      await fn();
      return;
    } catch (error) {
      console.error(`[instrumentation] ${name} startup failed (attempt ${attempt}/${STARTUP_RETRIES}):`, error);
      if (attempt < STARTUP_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  console.error(`[instrumentation] ${name} failed after ${STARTUP_RETRIES} attempts. NOT RUNNING.`);
}

export function registerNodeInstrumentation(): void {
  runBootChecks();

  process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled rejection:', reason);
  });

  void startWithRetry('Post scheduler', async () => {
    const { startInAppScheduler } = await import('./lib/scheduler-runner');
    startInAppScheduler();
  });

  void startWithRetry('Action scheduler', async () => {
    const { startActionSchedulerLoop } = await import('./lib/action-scheduler');
    startActionSchedulerLoop({ intervalSeconds: 30 });
    console.log('[instrumentation] Action scheduler started (30s interval).');
  });

  void startWithRetry('Metrics collector', async () => {
    const { startMetricsCollectorLoop } = await import('./lib/metrics-collector');
    startMetricsCollectorLoop(900);
    console.log('[instrumentation] Metrics collector started (15m interval).');
  });
}
