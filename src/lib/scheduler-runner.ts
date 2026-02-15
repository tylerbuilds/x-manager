import { startSchedulerLoop } from './scheduler-service';

declare global {
  var __xManagerSchedulerStarted: boolean | undefined;
}

function isDisabled(): boolean {
  return process.env.DISABLE_IN_APP_SCHEDULER === 'true';
}

export function startInAppScheduler(): void {
  if (isDisabled()) {
    return;
  }

  if (globalThis.__xManagerSchedulerStarted) {
    return;
  }

  const intervalSeconds = Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60));

  startSchedulerLoop({
    key: 'in-app',
    intervalSeconds,
    runOnStart: true,
  });

  globalThis.__xManagerSchedulerStarted = true;
}
