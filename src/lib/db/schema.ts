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
