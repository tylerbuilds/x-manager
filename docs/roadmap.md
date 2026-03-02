# x-manager Feature Roadmap

**Created:** 2026-03-02
**Source:** docs/gap-analysis.md (competitive audit)
**Goal:** Reach 97% agent controllability + Hootsuite feature parity for X

---

## Sprint 1: Agent Autonomy Foundation
**Status:** COMPLETE
**Owner:** Agent (Claude Opus)
**Estimated effort:** 3-4 days
**Goal:** Enable agents to operate without constant polling

### 1.1 Auto-schedule (AI optimal time)
- Add `auto_optimal_time: boolean` param to `POST /api/scheduler/posts` and `POST /api/scheduler/thread`
- When true, query the best-times heatmap data internally and pick the next optimal slot
- Logic: find the highest-engagement hour in the next 24-72h that doesn't already have a post scheduled
- Reuse existing `GET /api/analytics/best-times` logic (src/app/api/analytics/best-times/route.ts)
- Also expose as `POST /api/scheduler/suggest-time` for agents that want to pick from options
- **Files:** `src/app/api/scheduler/posts/route.ts`, `src/app/api/scheduler/thread/route.ts`, `src/lib/optimal-time.ts` (new), `src/app/api/scheduler/suggest-time/route.ts` (new)

### 1.2 Bulk engagement actions
- New endpoint: `POST /api/engagement/actions/bulk`
- Accepts JSON array of actions: `{ items: [{ action: "like"|"dismiss"|"reply"|"repost", inbox_id: string, text?: string }] }`
- Returns per-item results: `{ results: [{ inbox_id, status: "ok"|"error", error?: string }] }`
- Wraps existing action endpoints (like, repost, reply, dm) with error isolation per item
- Max 25 items per request
- **Files:** `src/app/api/engagement/actions/bulk/route.ts` (new)

### 1.3 Event/notification system
- New table: `events` — id, event_type, entity_type, entity_id, payload (JSON), created_at, read_at
- Event types: `post.posted`, `post.failed`, `post.scheduled`, `thread.completed`, `thread.failed`, `inbox.new_mention`, `inbox.new_dm`, `campaign.task_completed`, `campaign.completed`, `system.error`
- Emit events from: scheduler-service.ts (post success/fail), engagement sync (new items), campaign executor (task completion)
- New endpoints:
  - `GET /api/events` — list events with filtering (type, entity, since, unread)
  - `GET /api/events/stream` — SSE (Server-Sent Events) endpoint for real-time push
  - `PATCH /api/events/:id` — mark as read
  - `DELETE /api/events` — clear old events
- SSE: keep-alive every 30s, auto-reconnect friendly, filter by event_type query param
- **Files:** `src/lib/db/schema.ts` (add events table), `src/lib/db/init.ts` (add events table), `src/lib/events.ts` (new — emitEvent helper), `src/app/api/events/route.ts` (new), `src/app/api/events/stream/route.ts` (new), `src/app/api/events/[id]/route.ts` (new), `src/lib/scheduler-service.ts` (emit events on post/fail)

### 1.4 Webhook delivery reliability
- New table: `webhook_deliveries` — id, webhook_id, event_id, status (pending/delivered/failed), attempts, last_attempt_at, response_status, response_body, created_at
- On event emission, queue delivery for all matching webhooks
- Delivery worker: retry up to 3 times with exponential backoff (5s, 30s, 5min)
- New endpoints:
  - `GET /api/agent/webhooks/:id/deliveries` — list delivery attempts for a webhook
  - `POST /api/agent/webhooks/:id/test` — send test event to webhook URL
- **Files:** `src/lib/db/schema.ts` (add webhook_deliveries table), `src/lib/db/init.ts`, `src/lib/webhook-delivery.ts` (new), `src/app/api/agent/webhooks/[id]/deliveries/route.ts` (new), `src/app/api/agent/webhooks/[id]/test/route.ts` (new)

---

## Sprint 2: Content Management
**Status:** COMPLETE
**Owner:** Agent (Claude Opus)
**Estimated effort:** 4-5 days
**Goal:** Enable content reuse and recurring schedules

### 2.1 Content/media library
- New table: `media_library` — id, filename, original_name, mime_type, size_bytes, width, height, tags (JSON array), description, uploaded_at, used_count
- CRUD endpoints:
  - `GET /api/media` — list with search, tag filter, mime filter, pagination
  - `POST /api/media` — upload file(s) to library (distinct from scheduler media which is ephemeral)
  - `GET /api/media/:id` — get metadata
  - `PATCH /api/media/:id` — update tags, description
  - `DELETE /api/media/:id` — remove from library + disk
- Reference media by library ID in post creation: `media_library_ids: [id1, id2]`
- UI: gallery panel accessible from scheduler with drag-to-attach
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/media/route.ts` (new), `src/app/api/media/[id]/route.ts` (new), `src/components/MediaLibrary.tsx` (new), modify `src/app/api/scheduler/posts/route.ts` to accept library refs

### 2.2 Recurring/evergreen posts
- New table: `recurring_schedules` — id, account_slot, text, media_library_ids (JSON), community_id, frequency (daily/weekly/biweekly/monthly/custom_cron), next_run_at, last_run_at, times_run, max_runs, status (active/paused/exhausted), created_at
- New table: `content_pool` — id, recurring_schedule_id, text, media_library_ids (JSON), used_count, last_used_at — for rotating content pools
- CRUD endpoints:
  - `GET /api/scheduler/recurring` — list recurring schedules
  - `POST /api/scheduler/recurring` — create recurring schedule or content pool
  - `PATCH /api/scheduler/recurring/:id` — update schedule/pause/resume
  - `DELETE /api/scheduler/recurring/:id` — delete
- Processor: in scheduler cycle (instrumentation-node.ts), check `recurring_schedules` for `next_run_at <= now`, create scheduled_post, update next_run_at
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/scheduler/recurring/route.ts` (new), `src/app/api/scheduler/recurring/[id]/route.ts` (new), `src/lib/recurring-processor.ts` (new), `src/instrumentation-node.ts`

---

## Sprint 3: Automation Engine
**Status:** COMPLETE
**Owner:** Agent (Claude Opus)
**Estimated effort:** 5-7 days
**Goal:** Event-driven automation without manual intervention

### 3.1 Rule engine
- New table: `automation_rules` — id, name, trigger_type, trigger_config (JSON), conditions (JSON array), action_type, action_config (JSON), account_slot, enabled, run_count, last_run_at, created_at
- Trigger types: `event` (fires on event type), `schedule` (cron), `keyword` (fires when keyword detected in inbox)
- Condition operators: equals, contains, regex, gt, lt
- Action types: `like`, `reply`, `repost`, `schedule_post`, `send_dm`, `dismiss`, `tag`, `webhook`
- CRUD endpoints:
  - `GET /api/automation/rules` — list rules
  - `POST /api/automation/rules` — create rule
  - `PATCH /api/automation/rules/:id` — update/enable/disable
  - `DELETE /api/automation/rules/:id` — delete
  - `GET /api/automation/rules/:id/log` — execution history
- Executor: hooks into event system (Sprint 1.3), evaluates matching rules, executes actions
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/automation/rules/route.ts` (new), `src/app/api/automation/rules/[id]/route.ts` (new), `src/lib/automation-executor.ts` (new)

### 3.2 RSS feed monitor
- New table: `feeds` — id, url, title, account_slot, check_interval_minutes, last_checked_at, last_entry_id, auto_schedule (boolean), template (text with {title}, {url}, {summary} placeholders), status (active/paused), created_at
- New table: `feed_entries` — id, feed_id, entry_url, entry_title, published_at, scheduled_post_id (nullable), processed_at
- Polling job: runs every 15 minutes in scheduler cycle, fetches RSS XML, extracts new entries, optionally auto-schedules using template or create-thread
- CRUD endpoints:
  - `GET /api/feeds` — list feeds
  - `POST /api/feeds` — add feed
  - `PATCH /api/feeds/:id` — update/pause
  - `DELETE /api/feeds/:id` — remove
  - `GET /api/feeds/:id/entries` — list entries with scheduled status
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/feeds/route.ts` (new), `src/app/api/feeds/[id]/route.ts` (new), `src/app/api/feeds/[id]/entries/route.ts` (new), `src/lib/feed-processor.ts` (new)

### 3.3 Keyword monitoring (saved searches)
- New table: `saved_searches` — id, keywords (JSON array), account_slot, check_interval_minutes, last_checked_at, auto_action (null|like|reply), reply_template, notify (boolean), status, created_at
- Runs in scheduler cycle, uses discovery/topics endpoint logic internally
- New matching items trigger events or auto-actions
- CRUD endpoints:
  - `GET /api/discovery/saved` — list saved searches
  - `POST /api/discovery/saved` — create
  - `PATCH /api/discovery/saved/:id` — update
  - `DELETE /api/discovery/saved/:id` — remove
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/discovery/saved/route.ts` (new), `src/app/api/discovery/saved/[id]/route.ts` (new), `src/lib/keyword-monitor.ts` (new)

---

## Sprint 4: Analytics & Tracking
**Status:** NOT STARTED
**Owner:** Unassigned
**Estimated effort:** 3-4 days
**Goal:** Measure what matters

### 4.1 URL shortener with click tracking
- New table: `short_urls` — id, short_code, target_url, utm_source, utm_medium, utm_campaign, click_count, created_at, post_id (nullable)
- Redirect handler: `GET /r/:code` — 301 redirect + increment counter + log click
- New table: `url_clicks` — id, short_url_id, clicked_at, referer, user_agent, ip_hash
- Auto-shorten URLs in scheduled posts when `auto_shorten: true`
- API endpoints:
  - `POST /api/urls/shorten` — create short URL
  - `GET /api/urls/:code/stats` — click analytics
  - `GET /api/urls` — list all short URLs with click counts
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/urls/route.ts` (new), `src/app/api/urls/[code]/route.ts` (new), `src/app/r/[code]/route.ts` (new)

### 4.2 Follower growth tracking
- New table: `follower_snapshots` — id, account_slot, followers_count, following_count, snapshot_at
- Snapshot job: runs once daily in scheduler cycle, fetches account info from X API
- API endpoints:
  - `GET /api/analytics/followers` — timeseries of follower counts
  - `GET /api/analytics/followers/growth` — daily delta + growth rate
- **Files:** `src/lib/db/schema.ts`, `src/lib/db/init.ts`, `src/app/api/analytics/followers/route.ts` (new), `src/lib/follower-tracker.ts` (new)

### 4.3 Report export
- API endpoints:
  - `GET /api/analytics/export?format=csv&period=30d` — CSV export of post metrics
  - `GET /api/analytics/export?format=json&period=30d` — JSON export for agent consumption
- Include: post text, scheduled_time, posted_time, impressions, likes, retweets, replies, engagement_rate, url_clicks
- **Files:** `src/app/api/analytics/export/route.ts` (new)

---

## Sprint 5: UX Polish
**Status:** NOT STARTED
**Owner:** Unassigned
**Estimated effort:** 4-5 days
**Goal:** Close the UI gap with competitors

### 5.1 Draft management UI
- New component: `DraftManager.tsx` — list/edit/delete/schedule drafts
- Wire into Ops Center or as standalone view
- Drafts API already exists (`/api/drafts`)

### 5.2 Post preview rendering
- Component that renders tweet text as it would appear on X (links, mentions, hashtags highlighted)
- Optional: fetch OpenGraph data for link cards
- Show character count with weighted URL counting

### 5.3 Content categories on posts
- Add `tags` column to `scheduled_posts` (JSON array)
- Filter posts by tag in `GET /api/scheduler/posts`
- UI: tag selector in post creation

### 5.4 Per-post approval workflow
- Extend `campaign_approvals` or create `post_approvals` table
- `POST /api/scheduler/posts/:id/request-approval`
- `PATCH /api/scheduler/posts/:id/approve`
- Post stays in `pending_approval` status until approved

### 5.5 Global search
- `GET /api/search?q=keyword` — searches across posts, inbox, campaigns, drafts, templates
- Returns unified results with entity_type + entity_id + excerpt
- UI: enable the disabled search button in topbar

---

## Cross-Sprint Notes

### DB Schema Changes
Each sprint adds tables. Keep them in both `src/lib/db/schema.ts` (Drizzle) and `src/lib/db/init.ts` (raw SQL). Follow existing pattern.

### Event Emission
After Sprint 1, all new features should emit events. RSS feed → `feed.new_entry`, recurring schedule → `recurring.executed`, automation rule → `automation.executed`.

### Testing
Each sprint should include basic TypeScript check + build verification. Integration tests optional but valuable for the automation engine.

### Agent Manifest
Update `GET /api/system/agent` response after each sprint to include new endpoints.
