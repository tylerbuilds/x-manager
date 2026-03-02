import { runBootChecks } from './lib/boot-checks';
import { logger } from './lib/logger';

const log = logger('instrumentation');
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
      log.error(`${name} startup failed (attempt ${attempt}/${STARTUP_RETRIES})`, error instanceof Error ? error : undefined);
      if (attempt < STARTUP_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  log.error(`${name} failed after ${STARTUP_RETRIES} attempts. NOT RUNNING.`);
}

export function registerNodeInstrumentation(): void {
  runBootChecks();

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception', error);
    // Do NOT process.exit() — kills the entire single-process Next.js server.
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', reason instanceof Error ? reason : undefined);
  });

  void startWithRetry('Post scheduler', async () => {
    const { startInAppScheduler } = await import('./lib/scheduler-runner');
    startInAppScheduler();
  });

  void startWithRetry('Action scheduler', async () => {
    const { startActionSchedulerLoop } = await import('./lib/action-scheduler');
    startActionSchedulerLoop({ intervalSeconds: 30 });
    log.info('Action scheduler started (30s interval).');
  });

  void startWithRetry('Automation event listener', async () => {
    const { startAutomationEventListener } = await import('./lib/automation-executor');
    startAutomationEventListener();
    log.info('Automation event listener started.');
  });

  void startWithRetry('Recurring processor', async () => {
    const { processRecurringSchedules, isRecurringProcessorStarted, markRecurringProcessorStarted } = await import('./lib/recurring-processor');
    if (isRecurringProcessorStarted()) {
      log.info('Recurring processor already running, skipping.');
      return;
    }
    markRecurringProcessorStarted();
    const intervalMs = Math.max(60, Number(process.env.RECURRING_INTERVAL_SECONDS) || 300) * 1000;
    setInterval(async () => {
      try {
        const result = await processRecurringSchedules();
        if (result.created > 0) {
          log.info(`Processed ${result.processed} recurring schedules, created ${result.created} posts.`);
        }
      } catch (error) {
        log.error('Recurring processor cycle error', error instanceof Error ? error : undefined);
      }
    }, intervalMs);
    log.info(`Recurring processor started (${intervalMs / 1000}s interval).`);
  });

  void startWithRetry('Follower tracker', async () => {
    const { takeFollowerSnapshots, isFollowerTrackerStarted, markFollowerTrackerStarted } = await import('./lib/follower-tracker');
    if (isFollowerTrackerStarted()) {
      log.info('Follower tracker already running, skipping.');
      return;
    }
    markFollowerTrackerStarted();
    // Snapshot once daily (86400s), check every hour
    const intervalMs = 3600 * 1000;
    setInterval(() => {
      try {
        const created = takeFollowerSnapshots();
        if (created > 0) {
          log.info(`Recorded ${created} follower snapshot(s).`);
        }
      } catch (error) {
        log.error('Follower tracker cycle error', error instanceof Error ? error : undefined);
      }
    }, intervalMs);
    // Take initial snapshot on startup
    try {
      takeFollowerSnapshots();
    } catch { /* best-effort */ }
    log.info('Follower tracker started (1h interval).');
  });

  // S5 fix: Recover pending webhook deliveries that were lost on previous restart
  void startWithRetry('Webhook recovery', async () => {
    const { recoverPendingDeliveries } = await import('./lib/webhook-delivery');
    recoverPendingDeliveries();
    log.info('Webhook delivery recovery complete.');
  });

  if (process.env.DISABLE_METRICS_COLLECTOR === 'true') {
    log.info('Metrics collector disabled via DISABLE_METRICS_COLLECTOR.');
  } else {
    const metricsInterval = Math.max(60, Number(process.env.METRICS_INTERVAL_SECONDS) || 3600);
    void startWithRetry('Metrics collector', async () => {
      const { startMetricsCollectorLoop } = await import('./lib/metrics-collector');
      startMetricsCollectorLoop(metricsInterval);
      log.info(`Metrics collector started (${metricsInterval}s interval).`);
    });
  }
}
