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
}
