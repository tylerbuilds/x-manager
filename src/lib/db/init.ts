import type BetterSqlite3 from 'better-sqlite3';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '../scheduler-dedupe';
import { canEncryptSecrets, encryptValue, isEncryptedValue } from '../crypto-store';

let isInitialized = false;

type SqliteDb = BetterSqlite3.Database;

function sleepMs(ms: number): void {
  // Synchronous sleep without spinning the CPU.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

function execWithRetry(sqlite: SqliteDb, sqlText: string, attempts = 8, delayMs = 120): void {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      sqlite.exec(sqlText);
      return;
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < attempts - 1) {
        sleepMs(delayMs);
        continue;
      }
      throw error;
    }
  }
}

function hasColumn(sqlite: SqliteDb, tableName: string, columnName: string): boolean {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(sqlite: SqliteDb, tableName: string, columnName: string, sql: string): void {
  if (!hasColumn(sqlite, tableName, columnName)) {
    sqlite.exec(sql);
  }
}

export function ensureSchema(sqlite: SqliteDb): void {
  if (isInitialized) {
    return;
  }

  execWithRetry(sqlite, `
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY,
      twitter_user_id TEXT,
      twitter_username TEXT,
      twitter_display_name TEXT,
      twitter_access_token TEXT,
      twitter_access_token_secret TEXT
    );

    CREATE TABLE IF NOT EXISTS x_accounts (
      id INTEGER PRIMARY KEY,
      slot INTEGER NOT NULL UNIQUE,
      twitter_user_id TEXT,
      twitter_username TEXT,
      twitter_display_name TEXT,
      twitter_access_token TEXT,
      twitter_access_token_secret TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      source_url TEXT,
      dedupe_key TEXT,
      thread_id TEXT,
      thread_index INTEGER,
      media_urls TEXT,
      community_id TEXT,
      reply_to_tweet_id TEXT,
      scheduled_time INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      twitter_post_id TEXT,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS community_tags (
      id INTEGER PRIMARY KEY,
      tag_name TEXT NOT NULL,
      community_id TEXT NOT NULL,
      community_name TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS topic_search_cache (
      id INTEGER PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      query TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduler_locks (
      id INTEGER PRIMARY KEY,
      lock_key TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS engagement_inbox (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      conversation_id TEXT,
      author_user_id TEXT,
      author_username TEXT,
      text TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS engagement_actions (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER,
      account_slot INTEGER NOT NULL DEFAULT 1,
      action_type TEXT NOT NULL,
      target_id TEXT,
      payload TEXT NOT NULL,
      result TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      account_slot INTEGER NOT NULL DEFAULT 1,
      instructions TEXT,
      start_at INTEGER,
      end_at INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaign_tasks (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      due_at INTEGER,
      priority INTEGER NOT NULL DEFAULT 2,
      assigned_agent TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaign_approvals (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      task_id INTEGER,
      requested_by TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'pending',
      decision_note TEXT,
      requested_at INTEGER DEFAULT (unixepoch()),
      decided_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_search_cache_key
      ON topic_search_cache(cache_key);

    CREATE INDEX IF NOT EXISTS idx_topic_search_cache_expires
      ON topic_search_cache(expires_at);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_time
      ON scheduled_posts(status, scheduled_time);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_account_status_time
      ON scheduled_posts(account_slot, status, scheduled_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_x_accounts_slot
      ON x_accounts(slot);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_key
      ON app_settings(setting_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_locks_key
      ON scheduler_locks(lock_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_inbox_source
      ON engagement_inbox(account_slot, source_type, source_id);

    CREATE INDEX IF NOT EXISTS idx_engagement_inbox_status
      ON engagement_inbox(account_slot, status, received_at);

    CREATE INDEX IF NOT EXISTS idx_engagement_actions_created
      ON engagement_actions(account_slot, created_at);

    CREATE INDEX IF NOT EXISTS idx_campaigns_status
      ON campaigns(account_slot, status, start_at, end_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_tasks_campaign
      ON campaign_tasks(campaign_id, status, due_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_approvals_status
      ON campaign_approvals(campaign_id, status, requested_at);
  `);

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'account_slot',
    'ALTER TABLE scheduled_posts ADD COLUMN account_slot INTEGER NOT NULL DEFAULT 1',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'reply_to_tweet_id',
    'ALTER TABLE scheduled_posts ADD COLUMN reply_to_tweet_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'community_id',
    'ALTER TABLE scheduled_posts ADD COLUMN community_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'media_urls',
    'ALTER TABLE scheduled_posts ADD COLUMN media_urls TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'source_url',
    'ALTER TABLE scheduled_posts ADD COLUMN source_url TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'dedupe_key',
    'ALTER TABLE scheduled_posts ADD COLUMN dedupe_key TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'thread_id',
    'ALTER TABLE scheduled_posts ADD COLUMN thread_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'thread_index',
    'ALTER TABLE scheduled_posts ADD COLUMN thread_index INTEGER',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'twitter_post_id',
    'ALTER TABLE scheduled_posts ADD COLUMN twitter_post_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'error_message',
    'ALTER TABLE scheduled_posts ADD COLUMN error_message TEXT',
  );

  execWithRetry(sqlite, `
    UPDATE scheduled_posts
    SET account_slot = 1
    WHERE account_slot IS NULL OR account_slot NOT IN (1, 2);

    INSERT INTO x_accounts (
      slot,
      twitter_user_id,
      twitter_username,
      twitter_display_name,
      twitter_access_token,
      twitter_access_token_secret
    )
    SELECT
      1,
      twitter_user_id,
      twitter_username,
      twitter_display_name,
      twitter_access_token,
      twitter_access_token_secret
    FROM user
    WHERE id = 1
      AND twitter_access_token IS NOT NULL
      AND twitter_access_token_secret IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM x_accounts WHERE slot = 1);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_thread
      ON scheduled_posts(thread_id, thread_index);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_account_dedupe_key
      ON scheduled_posts(account_slot, dedupe_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_posts_account_dedupe_scheduled
      ON scheduled_posts(account_slot, dedupe_key)
      WHERE status = 'scheduled' AND dedupe_key IS NOT NULL;
  `);

  // Backfill source_url + dedupe_key for older rows so dedupe works consistently.
  try {
    const rows = sqlite
      .prepare(
        `SELECT id, account_slot, text, source_url, dedupe_key
         FROM scheduled_posts
         WHERE status = 'scheduled'
           AND (dedupe_key IS NULL OR source_url IS NULL)`,
      )
      .all() as Array<{
      id: number;
      account_slot: number;
      text: string;
      source_url: string | null;
      dedupe_key: string | null;
    }>;

    if (rows.length > 0) {
      const stmt = sqlite.prepare(
        `UPDATE scheduled_posts
         SET source_url = ?, dedupe_key = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of rows) {
        const urlCandidate = row.source_url || extractFirstUrl(row.text || '');
        const canonicalUrl = urlCandidate ? canonicalizeUrl(urlCandidate) : null;
        const normalizedCopy = normalizeCopy(row.text || '');
        const dedupeKey = canonicalUrl
          ? computeDedupeKey({ accountSlot: row.account_slot, canonicalUrl, normalizedCopy })
          : null;

        stmt.run(canonicalUrl, dedupeKey, row.id);
      }
    }
  } catch (error) {
    console.error('Schema init warning: failed to backfill dedupe fields:', error);
  }

  // Encrypt legacy plaintext credential values where possible.
  if (canEncryptSecrets()) {
    try {
      const migrateRows = sqlite.prepare(
        `SELECT id, setting_key, setting_value
         FROM app_settings
         WHERE setting_key IN ('x_api_key', 'x_api_secret', 'x_bearer_token')`,
      ).all() as Array<{
        id: number;
        setting_key: string;
        setting_value: string;
      }>;

      const updateSetting = sqlite.prepare(
        `UPDATE app_settings
         SET setting_value = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of migrateRows) {
        if (row.setting_value && !isEncryptedValue(row.setting_value)) {
          updateSetting.run(encryptValue(row.setting_value), row.id);
        }
      }

      const migrateAccounts = sqlite.prepare(
        `SELECT id, twitter_access_token, twitter_access_token_secret
         FROM x_accounts`,
      ).all() as Array<{
        id: number;
        twitter_access_token: string | null;
        twitter_access_token_secret: string | null;
      }>;

      const updateAccount = sqlite.prepare(
        `UPDATE x_accounts
         SET twitter_access_token = ?, twitter_access_token_secret = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of migrateAccounts) {
        const token = row.twitter_access_token;
        const tokenSecret = row.twitter_access_token_secret;
        if (!token || !tokenSecret) continue;
        if (isEncryptedValue(token) && isEncryptedValue(tokenSecret)) continue;
        updateAccount.run(encryptValue(token), encryptValue(tokenSecret), row.id);
      }
    } catch (error) {
      console.error('Schema init warning: failed to encrypt legacy credential rows:', error);
    }
  }

  isInitialized = true;
}
