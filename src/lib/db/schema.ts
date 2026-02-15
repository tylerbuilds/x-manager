import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const user = sqliteTable('user', {
  id: integer('id').primaryKey(),
  twitterUserId: text('twitter_user_id'),
  twitterUsername: text('twitter_username'),
  twitterDisplayName: text('twitter_display_name'),
  twitterAccessToken: text('twitter_access_token'),
  twitterAccessTokenSecret: text('twitter_access_token_secret'),
});

export const xAccounts = sqliteTable('x_accounts', {
  id: integer('id').primaryKey(),
  slot: integer('slot').notNull().unique(),
  twitterUserId: text('twitter_user_id'),
  twitterUsername: text('twitter_username'),
  twitterDisplayName: text('twitter_display_name'),
  twitterAccessToken: text('twitter_access_token'),
  twitterAccessTokenSecret: text('twitter_access_token_secret'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const scheduledPosts = sqliteTable('scheduled_posts', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull().default(1),
  text: text('text').notNull(),
  sourceUrl: text('source_url'),
  dedupeKey: text('dedupe_key'),
  threadId: text('thread_id'),
  threadIndex: integer('thread_index'),
  mediaUrls: text('media_urls'), // JSON string array
  communityId: text('community_id'),
  replyToTweetId: text('reply_to_tweet_id'),
  scheduledTime: integer('scheduled_time', { mode: 'timestamp' }).notNull(),
  status: text('status', { enum: ['scheduled', 'posted', 'failed', 'cancelled'] }).default('scheduled').notNull(),
  twitterPostId: text('twitter_post_id'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const topicSearchCache = sqliteTable('topic_search_cache', {
  id: integer('id').primaryKey(),
  cacheKey: text('cache_key').notNull().unique(),
  query: text('query').notNull(),
  payload: text('payload').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable('app_settings', {
  id: integer('id').primaryKey(),
  settingKey: text('setting_key').notNull().unique(),
  settingValue: text('setting_value').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const communityTags = sqliteTable('community_tags', {
  id: integer('id').primaryKey(),
  tagName: text('tag_name').notNull(),
  communityId: text('community_id').notNull(),
  communityName: text('community_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const systemPrompts = sqliteTable('system_prompts', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const schedulerLocks = sqliteTable('scheduler_locks', {
  id: integer('id').primaryKey(),
  lockKey: text('lock_key').notNull().unique(),
  ownerId: text('owner_id').notNull(),
  leaseUntil: integer('lease_until').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const engagementInbox = sqliteTable('engagement_inbox', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull().default(1),
  sourceType: text('source_type', { enum: ['mention', 'dm'] }).notNull(),
  sourceId: text('source_id').notNull(),
  conversationId: text('conversation_id'),
  authorUserId: text('author_user_id'),
  authorUsername: text('author_username'),
  text: text('text').notNull(),
  rawPayload: text('raw_payload').notNull(),
  receivedAt: integer('received_at', { mode: 'timestamp' }).notNull(),
  status: text('status', { enum: ['new', 'reviewed', 'replied', 'dismissed'] }).notNull().default('new'),
  assignedTo: text('assigned_to').default('unassigned'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const engagementActions = sqliteTable('engagement_actions', {
  id: integer('id').primaryKey(),
  inboxId: integer('inbox_id'),
  accountSlot: integer('account_slot').notNull().default(1),
  actionType: text('action_type', { enum: ['reply', 'dm_send', 'like', 'repost', 'dismiss'] }).notNull(),
  targetId: text('target_id'),
  payload: text('payload').notNull(),
  result: text('result'),
  status: text('status', { enum: ['success', 'failed'] }).notNull(),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const campaigns = sqliteTable('campaigns', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  objective: text('objective').notNull(),
  accountSlot: integer('account_slot').notNull().default(1),
  instructions: text('instructions'),
  startAt: integer('start_at', { mode: 'timestamp' }),
  endAt: integer('end_at', { mode: 'timestamp' }),
  status: text('status', { enum: ['draft', 'active', 'paused', 'completed', 'archived'] }).notNull().default('draft'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const campaignTasks = sqliteTable('campaign_tasks', {
  id: integer('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  taskType: text('task_type', { enum: ['post', 'reply', 'dm', 'like', 'research', 'approval'] }).notNull(),
  title: text('title').notNull(),
  details: text('details'),
  dueAt: integer('due_at', { mode: 'timestamp' }),
  priority: integer('priority').notNull().default(2),
  assignedAgent: text('assigned_agent'),
  status: text('status', { enum: ['pending', 'in_progress', 'waiting_approval', 'done', 'failed', 'skipped'] })
    .notNull()
    .default('pending'),
  output: text('output'),
  requiresApproval: integer('requires_approval', { mode: 'boolean' }).notNull().default(false),
  approvalId: integer('approval_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const campaignApprovals = sqliteTable('campaign_approvals', {
  id: integer('id').primaryKey(),
  campaignId: integer('campaign_id').notNull(),
  taskId: integer('task_id'),
  requestedBy: text('requested_by').notNull().default('agent'),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull().default('pending'),
  decisionNote: text('decision_note'),
  requestedAt: integer('requested_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P1.1: Idempotency ---
export const apiIdempotency = sqliteTable('api_idempotency', {
  id: integer('id').primaryKey(),
  scope: text('scope').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  statusCode: integer('status_code').notNull(),
  responseJson: text('response_json').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P1.2: Durable Runs Model ---
export const agentRuns = sqliteTable('agent_runs', {
  id: integer('id').primaryKey(),
  campaignId: integer('campaign_id'),
  status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull().default('running'),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  requestedBy: text('requested_by'),
  inputJson: text('input_json'),
  outputJson: text('output_json'),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const agentRunSteps = sqliteTable('agent_run_steps', {
  id: integer('id').primaryKey(),
  runId: integer('run_id').notNull(),
  taskId: integer('task_id'),
  stepType: text('step_type').notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed', 'skipped'] }).notNull().default('running'),
  inputJson: text('input_json'),
  outputJson: text('output_json'),
  error: text('error'),
  startedAt: integer('started_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P1.5: Scheduled Engagement Actions ---
export const scheduledActions = sqliteTable('scheduled_actions', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull().default(1),
  actionType: text('action_type', { enum: ['reply', 'dm', 'like', 'repost'] }).notNull(),
  targetId: text('target_id'),
  payloadJson: text('payload_json').notNull(),
  scheduledTime: integer('scheduled_time', { mode: 'timestamp' }).notNull(),
  status: text('status', { enum: ['scheduled', 'completed', 'failed', 'cancelled'] }).notNull().default('scheduled'),
  resultJson: text('result_json'),
  error: text('error'),
  idempotencyKey: text('idempotency_key'),
  runId: integer('run_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P2.3: API Call Log ---
export const xApiCalls = sqliteTable('x_api_calls', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull(),
  endpoint: text('endpoint').notNull(),
  method: text('method').notNull(),
  statusCode: integer('status_code'),
  durationMs: integer('duration_ms'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P3.1: Engagement Cursors ---
export const engagementCursors = sqliteTable('engagement_cursors', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull(),
  cursorType: text('cursor_type', { enum: ['mention', 'dm'] }).notNull(),
  cursorValue: text('cursor_value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P3.3: Inbox Assignments, Tags, Notes ---
export const inboxTags = sqliteTable('inbox_tags', {
  id: integer('id').primaryKey(),
  inboxId: integer('inbox_id').notNull(),
  tag: text('tag').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const inboxNotes = sqliteTable('inbox_notes', {
  id: integer('id').primaryKey(),
  inboxId: integer('inbox_id').notNull(),
  author: text('author').notNull().default('operator'),
  note: text('note').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- P4.2: Drafts and Templates ---
export const draftPosts = sqliteTable('draft_posts', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull().default(1),
  text: text('text').notNull(),
  mediaUrls: text('media_urls'),
  communityId: text('community_id'),
  replyToTweetId: text('reply_to_tweet_id'),
  threadId: text('thread_id'),
  threadIndex: integer('thread_index'),
  source: text('source'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const postTemplates = sqliteTable('post_templates', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  template: text('template').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- Phase 1: Post Metrics ---
export const postMetrics = sqliteTable('post_metrics', {
  id: integer('id').primaryKey(),
  scheduledPostId: integer('scheduled_post_id').notNull(),
  twitterPostId: text('twitter_post_id').notNull(),
  accountSlot: integer('account_slot').notNull(),
  impressions: integer('impressions').notNull().default(0),
  likes: integer('likes').notNull().default(0),
  retweets: integer('retweets').notNull().default(0),
  replies: integer('replies').notNull().default(0),
  quotes: integer('quotes').notNull().default(0),
  bookmarks: integer('bookmarks').notNull().default(0),
  fetchedAt: integer('fetched_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- Phase 4: Saved Replies ---
export const savedReplies = sqliteTable('saved_replies', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category'),
  text: text('text').notNull(),
  shortcut: text('shortcut'),
  useCount: integer('use_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

// --- Phase 5: Content Queue ---
export const contentQueue = sqliteTable('content_queue', {
  id: integer('id').primaryKey(),
  accountSlot: integer('account_slot').notNull().default(1),
  text: text('text').notNull(),
  mediaUrls: text('media_urls'),
  communityId: text('community_id'),
  position: integer('position').notNull().default(0),
  status: text('status', { enum: ['queued', 'scheduled', 'cancelled'] }).notNull().default('queued'),
  scheduledPostId: integer('scheduled_post_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});
