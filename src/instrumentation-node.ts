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

  void startWithRetry('Automation event listener', async () => {
    const { startAutomationEventListener } = await import('./lib/automation-executor');
    startAutomationEventListener();
    console.log('[instrumentation] Automation event listener started.');
  });

  void startWithRetry('Recurring processor', async () => {
    const { processRecurringSchedules, isRecurringProcessorStarted, markRecurringProcessorStarted } = await import('./lib/recurring-processor');
    if (isRecurringProcessorStarted()) {
      console.log('[instrumentation] Recurring processor already running, skipping.');
      return;
    }
    markRecurringProcessorStarted();
    const intervalMs = Math.max(60, Number(process.env.RECURRING_INTERVAL_SECONDS) || 300) * 1000;
    setInterval(async () => {
      try {
        const result = await processRecurringSchedules();
        if (result.created > 0) {
          console.log(`[recurring] Processed ${result.processed} schedules, created ${result.created} posts.`);
        }
      } catch (error) {
        console.error('[recurring] Error in recurring processor cycle:', error);
      }
    }, intervalMs);
    console.log(`[instrumentation] Recurring processor started (${intervalMs / 1000}s interval).`);
  });

  void startWithRetry('Follower tracker', async () => {
    const { takeFollowerSnapshots, isFollowerTrackerStarted, markFollowerTrackerStarted } = await import('./lib/follower-tracker');
    if (isFollowerTrackerStarted()) {
      console.log('[instrumentation] Follower tracker already running, skipping.');
      return;
    }
    markFollowerTrackerStarted();
    // Snapshot once daily (86400s), check every hour
    const intervalMs = 3600 * 1000;
    setInterval(() => {
      try {
        const created = takeFollowerSnapshots();
        if (created > 0) {
          console.log(`[followers] Recorded ${created} follower snapshot(s).`);
        }
      } catch (error) {
        console.error('[followers] Error in follower tracker cycle:', error);
      }
    }, intervalMs);
    // Take initial snapshot on startup
    try {
      takeFollowerSnapshots();
    } catch { /* best-effort */ }
    console.log('[instrumentation] Follower tracker started (1h interval).');
  });

  if (process.env.DISABLE_METRICS_COLLECTOR === 'true') {
    console.log('[instrumentation] Metrics collector disabled via DISABLE_METRICS_COLLECTOR.');
  } else {
    const metricsInterval = Math.max(60, Number(process.env.METRICS_INTERVAL_SECONDS) || 3600);
    void startWithRetry('Metrics collector', async () => {
      const { startMetricsCollectorLoop } = await import('./lib/metrics-collector');
      startMetricsCollectorLoop(metricsInterval);
      console.log(`[instrumentation] Metrics collector started (${metricsInterval}s interval).`);
    });
  }
}
