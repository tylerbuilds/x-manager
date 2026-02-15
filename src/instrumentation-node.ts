import { runBootChecks } from './lib/boot-checks';

export function registerNodeInstrumentation(): void {
  runBootChecks();

  // Avoid failing the entire Next.js instrumentation hook due to transient DB issues.
  // Scheduler startup is best-effort and will log (not crash) on failure.
  void (async () => {
    try {
      const { startInAppScheduler } = await import('./lib/scheduler-runner');
      startInAppScheduler();
    } catch (error) {
      console.error('[instrumentation] Scheduler startup failed:', error);
    }
  })();

  void (async () => {
    try {
      const { startActionSchedulerLoop } = await import('./lib/action-scheduler');
      startActionSchedulerLoop({ intervalSeconds: 30 });
      console.log('[instrumentation] Action scheduler started (30s interval).');
    } catch (error) {
      console.error('[instrumentation] Action scheduler startup failed:', error);
    }
  })();

  void (async () => {
    try {
      const { startMetricsCollectorLoop } = await import('./lib/metrics-collector');
      startMetricsCollectorLoop(900); // 15 minutes
      console.log('[instrumentation] Metrics collector started (15m interval).');
    } catch (error) {
      console.error('[instrumentation] Metrics collector startup failed:', error);
    }
  })();
}
