import fs from 'fs/promises';
import path from 'path';
import { prepareCsvImport } from '../src/lib/csv-import';
import { normalizeAccountSlot, type AccountSlot } from '../src/lib/account-slots';
import { and, eq, inArray } from 'drizzle-orm';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '../src/lib/scheduler-dedupe';

interface CliOptions {
  filePath: string;
  dryRun: boolean;
  intervalMinutes: number;
  startTime?: Date;
  reschedulePast: boolean;
  accountSlot: AccountSlot;
}

function getArgValue(args: string[], name: string): string | undefined {
  const direct = args.find((arg) => arg.startsWith(`--${name}=`));
  if (direct) {
    return direct.split('=').slice(1).join('=');
  }

  const index = args.findIndex((arg) => arg === `--${name}`);
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }

  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const filePath = getArgValue(args, 'file') || '';
  const dryRun = hasFlag(args, 'dry-run');
  const intervalRaw = getArgValue(args, 'interval-minutes');
  const startTimeRaw = getArgValue(args, 'start-time');
  const reschedulePastRaw = getArgValue(args, 'reschedule-past');
  const accountSlotRaw = getArgValue(args, 'account-slot');

  const intervalMinutes = intervalRaw ? Number(intervalRaw) : 60;
  const normalizedInterval = Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? Math.floor(intervalMinutes) : 60;

  let startTime: Date | undefined;
  if (startTimeRaw) {
    const parsed = new Date(startTimeRaw);
    if (!Number.isNaN(parsed.getTime())) {
      startTime = parsed;
    }
  }

  let reschedulePast = true;
  if (reschedulePastRaw) {
    reschedulePast = ['1', 'true', 'yes', 'y'].includes(reschedulePastRaw.toLowerCase());
  }

  return {
    filePath,
    dryRun,
    intervalMinutes: normalizedInterval,
    startTime,
    reschedulePast,
    accountSlot: normalizeAccountSlot(accountSlotRaw, 1),
  };
}

function printUsage(): void {
  console.log(`
Usage:
  npm run import:csv -- --file ./tweets.csv [--dry-run] [--account-slot 1|2] [--interval-minutes 60] [--start-time "2026-02-10T09:00:00"] [--reschedule-past false]

Columns supported:
  text|tweet|post|content (required)
  scheduled_time|scheduled_at|date (optional)
  community_id (optional)
  reply_to_tweet_id (optional)
  account_slot (optional, defaults to --account-slot)
  `);
}

async function run(): Promise<void> {
  const options = parseCliArgs();

  if (!options.filePath) {
    printUsage();
    process.exit(1);
  }

  const absolutePath = path.isAbsolute(options.filePath)
    ? options.filePath
    : path.join(process.cwd(), options.filePath);

  const csvText = await fs.readFile(absolutePath, 'utf-8');
  const result = prepareCsvImport(csvText, {
    accountSlot: options.accountSlot,
    intervalMinutes: options.intervalMinutes,
    startTime: options.startTime,
    reschedulePast: options.reschedulePast,
  });

  console.log(`Rows in file: ${result.totalRows}`);
  console.log(`Valid rows: ${result.posts.length}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of result.warnings.slice(0, 20)) {
      console.log(`- Line ${warning.lineNumber}: ${warning.message}`);
    }
    if (result.warnings.length > 20) {
      console.log(`...and ${result.warnings.length - 20} more warnings`);
    }
  }

  if (result.errors.length > 0) {
    console.error('\nErrors:');
    for (const error of result.errors.slice(0, 20)) {
      console.error(`- Line ${error.lineNumber}: ${error.message}`);
    }
    if (result.errors.length > 20) {
      console.error(`...and ${result.errors.length - 20} more errors`);
    }
    process.exit(1);
  }

  console.log('\nPreview:');
  for (const post of result.posts.slice(0, 10)) {
    console.log(`- [line ${post.lineNumber}] ${post.scheduledTime.toISOString()} :: ${post.text.slice(0, 120)}`);
  }

  if (options.dryRun) {
    console.log('\nDry run only. Nothing inserted.');
    return;
  }

  const [{ drizzle }, sqliteModule, schema, init] = await Promise.all([
    import('drizzle-orm/better-sqlite3'),
    import('better-sqlite3'),
    import('../src/lib/db/schema'),
    import('../src/lib/db/init'),
  ]);

  const Database = sqliteModule.default;

  const rawDbPath = (process.env.X_MANAGER_DB_PATH || '').trim();
  const dbPath = rawDbPath
    ? (path.isAbsolute(rawDbPath) ? rawDbPath : path.join(process.cwd(), rawDbPath))
    : path.join(process.cwd(), 'var', 'x-manager.sqlite.db');

  await fs.mkdir(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath, { timeout: 5000 });
  init.ensureSchema(sqlite);
  const db = drizzle(sqlite, { schema });

  try {
    const values = result.posts.map((post) => {
      const extracted = extractFirstUrl(post.text);
      const canonicalUrl = extracted ? canonicalizeUrl(extracted) : null;
      const dedupeKey = canonicalUrl
        ? computeDedupeKey({
            accountSlot: post.accountSlot,
            canonicalUrl,
            normalizedCopy: normalizeCopy(post.text),
          })
        : null;

      return {
      accountSlot: post.accountSlot,
      text: post.text,
      sourceUrl: canonicalUrl,
      dedupeKey,
      scheduledTime: post.scheduledTime,
      communityId: post.communityId,
      replyToTweetId: post.replyToTweetId,
      status: 'scheduled' as const,
      };
    });

    const keysBySlot = new Map<number, string[]>();
    for (const value of values) {
      if (!value.dedupeKey) continue;
      const list = keysBySlot.get(value.accountSlot) || [];
      list.push(value.dedupeKey);
      keysBySlot.set(value.accountSlot, list);
    }

    const existingKeysBySlot = new Map<number, Set<string>>();
    for (const [slot, keys] of keysBySlot.entries()) {
      if (keys.length === 0) continue;
      const existing = await db
        .select({ dedupeKey: schema.scheduledPosts.dedupeKey })
        .from(schema.scheduledPosts)
        .where(and(eq(schema.scheduledPosts.accountSlot, slot), eq(schema.scheduledPosts.status, 'scheduled'), inArray(schema.scheduledPosts.dedupeKey, keys)));
      existingKeysBySlot.set(
        slot,
        new Set(existing.map((row) => row.dedupeKey).filter((key): key is string => Boolean(key))),
      );
    }

    const seenBySlot = new Map<number, Set<string>>();
    const filtered = values.filter((value) => {
      if (!value.dedupeKey) return true;
      const slot = value.accountSlot;
      const existingKeys = existingKeysBySlot.get(slot);
      if (existingKeys?.has(value.dedupeKey)) return false;
      const seen = seenBySlot.get(slot) || new Set<string>();
      if (seen.has(value.dedupeKey)) return false;
      seen.add(value.dedupeKey);
      seenBySlot.set(slot, seen);
      return true;
    });

    const skipped = values.length - filtered.length;

    const inserted = filtered.length > 0
      ? await db.insert(schema.scheduledPosts).values(filtered).returning()
      : [];

    console.log(`\nImported ${inserted.length} posts into scheduler.`);
    if (skipped > 0) {
      console.log(`Skipped ${skipped} duplicates (same URL + copy already scheduled).`);
    }
  } finally {
    sqlite.close();
  }
}

run().catch((error) => {
  console.error('CSV import failed:', error);
  process.exit(1);
});
