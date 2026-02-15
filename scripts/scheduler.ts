import path from 'path';
import * as dotenv from 'dotenv';
import { startSchedulerLoop } from '../src/lib/scheduler-service';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const intervalSeconds = Math.max(10, Number(process.env.SCHEDULER_INTERVAL_SECONDS || 60));

console.log('Starting dedicated scheduler worker...');
console.log(`Interval: ${intervalSeconds}s`);

startSchedulerLoop({
  key: 'worker',
  intervalSeconds,
  runOnStart: true,
});

process.on('SIGINT', () => {
  console.log('\nScheduler worker interrupted. Exiting...');
  process.exit(0);
});
