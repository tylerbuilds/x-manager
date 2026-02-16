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

const KNOWN_TABLES = new Set([
  'user', 'x_accounts', 'scheduled_posts', 'community_tags', 'system_prompts',
  'topic_search_cache', 'app_settings', 'scheduler_locks', 'engagement_inbox',
  'engagement_actions', 'campaigns', 'campaign_tasks', 'campaign_approvals',
  'api_idempotency', 'agent_runs', 'agent_run_steps', 'scheduled_actions',
  'x_api_calls', 'engagement_cursors', 'inbox_tags', 'inbox_notes',
  'draft_posts', 'post_templates', 'post_metrics', 'saved_replies',
  'content_queue', 'agent_webhooks',
]);

function hasColumn(sqlite: SqliteDb, tableName: string, columnName: string): boolean {
  if (!KNOWN_TABLES.has(tableName)) {
    throw new Error(`hasColumn called with unknown table: ${tableName}`);
  }
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

    -- P1.1: Idempotency
    CREATE TABLE IF NOT EXISTS api_idempotency (
      id INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_idempotency_scope_key
      ON api_idempotency(scope, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires
      ON api_idempotency(expires_at);

    -- P1.2: Durable Runs Model
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      dry_run INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER DEFAULT (unixepoch()),
      finished_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_campaign
      ON agent_runs(campaign_id, status, started_at);

    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL,
      task_id INTEGER,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER DEFAULT (unixepoch()),
      finished_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run
      ON agent_run_steps(run_id, started_at);

    -- P1.5: Scheduled Engagement Actions
    CREATE TABLE IF NOT EXISTS scheduled_actions (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      action_type TEXT NOT NULL,
      target_id TEXT,
      payload_json TEXT NOT NULL,
      scheduled_time INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      result_json TEXT,
      error TEXT,
      idempotency_key TEXT,
      run_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_actions_status_time
      ON scheduled_actions(status, scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_scheduled_actions_account
      ON scheduled_actions(account_slot, status, scheduled_time);

    -- P2.3: API Call Log
    CREATE TABLE IF NOT EXISTS x_api_calls (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_x_api_calls_slot_created
      ON x_api_calls(account_slot, created_at);

    -- P3.1: Engagement Cursors
    CREATE TABLE IF NOT EXISTS engagement_cursors (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL,
      cursor_type TEXT NOT NULL,
      cursor_value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_cursors_slot_type
      ON engagement_cursors(account_slot, cursor_type);

    -- P3.3: Inbox Tags and Notes
    CREATE TABLE IF NOT EXISTS inbox_tags (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_tags_inbox
      ON inbox_tags(inbox_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_tags_unique
      ON inbox_tags(inbox_id, tag);

    CREATE TABLE IF NOT EXISTS inbox_notes (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER NOT NULL,
      author TEXT NOT NULL DEFAULT 'operator',
      note TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_notes_inbox
      ON inbox_notes(inbox_id);

    -- P4.2: Drafts and Templates
    CREATE TABLE IF NOT EXISTS draft_posts (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      media_urls TEXT,
      community_id TEXT,
      reply_to_tweet_id TEXT,
      thread_id TEXT,
      thread_index INTEGER,
      source TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_draft_posts_account
      ON draft_posts(account_slot, created_at);

    CREATE TABLE IF NOT EXISTS post_templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      template TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 1: Post Metrics
    CREATE TABLE IF NOT EXISTS post_metrics (
      id INTEGER PRIMARY KEY,
      scheduled_post_id INTEGER NOT NULL,
      twitter_post_id TEXT NOT NULL,
      account_slot INTEGER NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      retweets INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      quotes INTEGER NOT NULL DEFAULT 0,
      bookmarks INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_post_metrics_twitter_id
      ON post_metrics(twitter_post_id);
    CREATE INDEX IF NOT EXISTS idx_post_metrics_scheduled_post
      ON post_metrics(scheduled_post_id, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_post_metrics_slot_fetched
      ON post_metrics(account_slot, fetched_at);

    -- Phase 4: Saved Replies
    CREATE TABLE IF NOT EXISTS saved_replies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      text TEXT NOT NULL,
      shortcut TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 5: Content Queue
    CREATE TABLE IF NOT EXISTS content_queue (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      media_urls TEXT,
      community_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      scheduled_post_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_content_queue_slot_status
      ON content_queue(account_slot, status, position);

    -- Agent Webhooks
    CREATE TABLE IF NOT EXISTS agent_webhooks (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_delivered_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_webhooks_active
      ON agent_webhooks(active);
  `);

  // P1.4: Approval gating columns on campaign_tasks
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'requires_approval',
    'ALTER TABLE campaign_tasks ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0',
  );
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'approval_id',
    'ALTER TABLE campaign_tasks ADD COLUMN approval_id INTEGER',
  );

  // P3.3: Inbox assignment
  ensureColumn(
    sqlite,
    'engagement_inbox',
    'assigned_to',
    "ALTER TABLE engagement_inbox ADD COLUMN assigned_to TEXT DEFAULT 'unassigned'",
  );

  // Phase 3: Conversation threading
  ensureColumn(
    sqlite,
    'engagement_inbox',
    'in_reply_to_tweet_id',
    'ALTER TABLE engagement_inbox ADD COLUMN in_reply_to_tweet_id TEXT',
  );

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

  // Profile enrichment columns on x_accounts
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_profile_image_url',
    'ALTER TABLE x_accounts ADD COLUMN twitter_profile_image_url TEXT',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_followers_count',
    'ALTER TABLE x_accounts ADD COLUMN twitter_followers_count INTEGER',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_friends_count',
    'ALTER TABLE x_accounts ADD COLUMN twitter_friends_count INTEGER',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_bio',
    'ALTER TABLE x_accounts ADD COLUMN twitter_bio TEXT',
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

  // Clear legacy plaintext tokens from the user table after migration to x_accounts.
  // The migration above copies tokens into x_accounts; keeping them in `user` is unnecessary
  // and leaves plaintext credentials in a table that predates the encrypted credential store.
  try {
    const hasUserTokenCol = hasColumn(sqlite, 'user', 'twitter_access_token');
    if (hasUserTokenCol) {
      const migrated = sqlite.prepare(
        `SELECT 1 FROM x_accounts WHERE slot = 1 AND twitter_access_token IS NOT NULL LIMIT 1`,
      ).get();
      if (migrated) {
        sqlite.prepare(
          `UPDATE user SET twitter_access_token = NULL, twitter_access_token_secret = NULL WHERE twitter_access_token IS NOT NULL`,
        ).run();
      }
    }
  } catch (error) {
    console.error('Schema init warning: failed to clear legacy user table tokens:', error);
  }

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
