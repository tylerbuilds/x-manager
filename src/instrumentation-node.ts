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
}
