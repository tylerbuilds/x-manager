# X Manager: Remaining Work (Agentic + Hootsuite-Level)

This doc is a handoff TODO list for implementing the remaining work to take **x-manager** from a working local scheduler into a **professional, agentic X operations platform** (Hootsuite-like).

Repo (current mount): `/Volumes/data-1/projects/x-manager`
UI: `http://127.0.0.1:3999`
Manifest for external agents: `GET /api/system/agent`

## How To Run (for implementers)

- Start: `npm run dev:ensure`
- Status: `npm run dev:status`
- Logs: `npm run dev:logs`
- Stop: `npm run dev:stop`

Agent-friendly CLI: `./xm ...`

If installs are flaky on a mounted/network volume, copy the repo to a local path and run `npm ci` there.

## What Already Exists (avoid re-implementing)

- 2 X accounts via slots `1` and `2` (`x_accounts`)
- Scheduler (single posts + threads, replies, media upload, dedupe key)
- CSV import (UI + API + CLI)
- Topic discovery (recent search + caching)
- Engagement inbox persistence (mentions + optional DMs via sync), plus immediate actions: reply, DM send, like, repost
- Campaign scaffolding: campaigns + tasks + approvals + default plan generator
- Agent manifest: `/api/system/agent` lists key endpoints + curl examples
- Security hardening:
  - Admin token auth (cookie session + `Authorization: Bearer ...`)
  - Secrets encrypted-at-rest in SQLite (AES-256-GCM)
  - Boot checks + readiness endpoint
  - Scheduler DB lease locking

Key code pointers:
- Scheduler: `src/lib/scheduler-service.ts`
- X API client: `src/lib/twitter-api-client.ts`
- Readiness: `src/app/api/system/readiness/route.ts`
- Agent manifest: `src/app/api/system/agent/route.ts`
- Engagement inbox/actions: `src/app/api/engagement/**`
- Campaigns/tasks/approvals: `src/app/api/agent/**`

## Primary Gap

The big missing piece is an **execution engine**: campaigns/tasks/approvals exist, but there is no API that reliably turns tasks into actions (schedule posts, reply/DM/like/repost) with:

- idempotency (safe retries)
- approval gating
- guardrails (quotas, allowed windows, safety rules)
- durable run logs + outputs

Everything below is structured to build that.

---

# P0: Stabilize The Project For Ongoing Development

## P0.1 Add/Restore Git

Current mount has no `.git` directory. Either:

- Restore the original git repo directory, or
- Re-initialize a git repo and push to a remote.

Acceptance:
- `git status` works
- a remote is set
- secrets are not committed (see `.gitignore`)

## P0.2 Pin Node + Package Manager

Native deps (notably `better-sqlite3`) are ABI sensitive.

- Pick Node LTS (recommend Node 22) and enforce it via `.nvmrc` or `.tool-versions`.
- Document the supported range in README.

Acceptance:
- `npm ci` works cleanly
- dev server runs without native module rebuild loops

## P0.3 Fix Known Dependency Security Issues

`next@14.2.3` is flagged vulnerable; upgrade to a patched version.

Recommended path:
- Upgrade to latest `14.2.x` first (minimal change), then evaluate Next 16 later.
- Run `npm audit` and address vulnerabilities (avoid `--force` unless you accept breaking changes).

Acceptance:
- `npm audit` no longer reports critical issues
- app builds and runs

---

# P1: Agentic Execution Engine (Core)

Goal: an external agent can say: "Operate account slot 1+2 for the next 7 days: schedule, reply, DM" and call x-manager endpoints safely.

## P1.1 Add Idempotency For All Mutating Endpoints

Motivation: external agents retry. Without idempotency, you double-post/double-DM.

Implement:
- Support `Idempotency-Key` header on:
  - `POST /api/scheduler/posts`
  - `POST /api/scheduler/thread`
  - `POST /api/engagement/actions/reply`
  - `POST /api/engagement/actions/dm`
  - `POST /api/engagement/actions/like`
  - `POST /api/engagement/actions/repost`
  - `POST /api/bridge/openclaw/post`
  - any new agent execution routes (below)

Implementation options (pick one and standardize):
1. Create a new table `api_idempotency` keyed by `(scope, key)` storing `status_code`, `response_json`, timestamps.
2. Extend existing tables (ex: `engagement_actions`) with `idempotency_key` + unique index.

Rules:
- Same key must return the same logical result for ~24h (configurable TTL).
- Key collisions should return the cached response with `skipped: true`.
- On constraint races, fetch the existing row and return it.

Acceptance:
- Calling the same action twice with same key does not duplicate work

## P1.2 Add A Durable "Runs" Model (Execution Logging)

Add tables (suggested):
- `agent_runs`:
  - `id`, `campaign_id`, `status`, `started_at`, `finished_at`, `requested_by`, `input_json`, `output_json`, `error`
- `agent_run_steps`:
  - `id`, `run_id`, `task_id`, `step_type`, `status`, `started_at`, `finished_at`, `input_json`, `output_json`, `error`

This provides a single place for:
- dry runs
- real runs
- step-by-step audit logs

Acceptance:
- every execution produces a run id
- UI and agents can query run status + output

## P1.3 Implement Task Execution Endpoints

Add:
- `POST /api/agent/tasks/:id/execute`
  - body: `{ dry_run?: boolean, idempotency_key?: string, actor?: string }`
  - behavior:
    - loads task
    - checks approvals/policy
    - executes the task (or simulates in dry run)
    - writes results into `campaign_tasks.output`
    - writes `agent_runs` + `agent_run_steps`

- `POST /api/agent/campaigns/:id/execute`
  - executes eligible tasks in order (ex: priority + due_at)
  - options: `max_tasks`, `dry_run`, `only_types`, `until`

- `GET /api/agent/runs` and `GET /api/agent/runs/:id`

Task-type mapping (v1):
- `research`:
  - calls discovery + optionally engagement sync
  - stores summary output + link list
- `post`:
  - schedules posts/threads (using existing scheduler APIs)
  - stores scheduled post ids
- `reply`:
  - sync inbox, pick items, create reply drafts
  - either schedule replies (see P1.5) or post immediately (config)
- `dm`:
  - send DMs based on a list in task details/output
- `like`:
  - like target tweet ids
- `approval`:
  - creates approval objects and blocks until approved

Acceptance:
- external agent can execute a task end-to-end via API
- dry-run returns a plan of actions without performing them

## P1.4 Approval Gating That Actually Blocks Execution

Today approvals exist, but execution does not enforce them.

Implement:
- A task in `waiting_approval` cannot execute until an approval record is `approved`.
- A task can declare "requires approval" even if it's not `task_type=approval`.

Suggested pattern:
- Add columns to `campaign_tasks`:
  - `requires_approval` (boolean)
  - `approval_id` (nullable)

Execution logic:
- If approval is required and missing: create it, set task status `waiting_approval`, stop.
- If approval is pending/rejected: stop.
- If approved: proceed.

Acceptance:
- agents cannot accidentally post/DM without an approval when configured
- Ops Center can approve and then rerun execution

## P1.5 Scheduled Engagement Actions (Not Just Immediate)

Right now engagement endpoints post immediately. For "operate over time", you need scheduled engagement actions.

Implement:
- New table `scheduled_actions`:
  - `id`, `account_slot`, `action_type` (reply/dm/like/repost), `target_id`, `payload_json`, `scheduled_time`, `status`, `result_json`, `error`, `idempotency_key`
- Worker loop (reuse scheduler locking):
  - `runScheduledActionsCycle()` similar to `runSchedulerCycle()`

Add endpoints:
- `POST /api/actions` (schedule)
- `GET /api/actions` (list)
- `POST /api/actions/retry`
- `DELETE /api/actions/:id`

Acceptance:
- agent can schedule replies/DMs for later
- retry is safe

---

# P2: Guardrails + Policy (Safety + Cost + Rate Limits)

## P2.1 Per-Slot Quotas and Allowed Windows

Implement policy checks in one shared module (ex: `src/lib/policy.ts`):
- Allowed posting windows (per slot, per day)
- Max scheduled posts/day
- Max replies/hour
- Max DMs/day
- Optional allowlist/denylist for recipients or domains

Enforcement points:
- At schedule time (reject or auto-adjust)
- At execution time (block if limit hit)
- At worker publish time (block with clear error)

Policy storage:
- Use `app_settings` (encrypted where needed)

Acceptance:
- configurable guardrails prevent runaway agents

## P2.2 Rate Limit and Backoff

Implement consistent behavior when X returns:
- 429 (rate limited)
- 503/5xx

Scheduler/worker should:
- back off per slot
- mark items as `failed` with retryable metadata
- avoid tight retry loops

Acceptance:
- no rapid-fire retries when rate-limited

## P2.3 Cost Controls + Usage Visibility

Existing: `/api/usage/tweets` proxy.

Add:
- Local call log table `x_api_calls` capturing endpoint/method/status/duration/slot
- A UI panel that summarizes:
  - recent API calls
  - failure rates
  - usage endpoint results

Acceptance:
- operator can see what the agent is "spending" via API calls

---

# P3: Engagement Inbox (Hootsuite-Grade)

## P3.1 Sync Cursor + De-Dupe Improvements

Today sync accepts `since_id` but does not persist a cursor.

Implement:
- per-slot cursor table (`engagement_cursors`) storing last mention id, last dm event id
- sync uses stored cursor by default
- UI shows "new since last sync"

Acceptance:
- repeated sync does not refetch/rewrite large payloads

## P3.2 Conversation View

Add support in DB/UI to group items by conversation:
- mentions: thread context (reply chain)
- DMs: conversation id

Acceptance:
- Ops Center shows conversations, not just flat items

## P3.3 Assignments + Tags + Notes

Hootsuite-style triage:
- assign inbox items to "agent"/"human"
- internal notes
- tags

Acceptance:
- operators can manage workload at scale

---

# P4: Publishing UX (Calendar, Queues, Library)

## P4.1 Real Calendar + Queues

Current scheduler UI is functional but not ops-grade.

Implement:
- day/week/month calendar views
- queues per slot (time slots templates)
- drag/drop rescheduling
- bulk edit

Acceptance:
- content planning feels like a modern social tool

## P4.2 Drafts and Templates

Implement:
- drafts table `draft_posts` (not scheduled)
- reusable templates (hooks, CTAs, disclaimers)

Acceptance:
- agent can generate drafts, human can approve, then schedule

## P4.3 Approval UX For Posts/Threads

Implement:
- show proposed scheduled posts/threads as an approval bundle
- approve/reject with edits

Acceptance:
- publishing can be "human-in-the-loop" without copy/paste

---

# P5: Testing + CI

## P5.1 Add Automated Tests

Add a minimal suite:
- API integration tests (schedule/dedupe/thread, engagement actions with mocks)
- DB migration/init tests
- idempotency tests

Tools suggestion:
- Vitest + node fetch mocks OR Playwright API tests

Acceptance:
- `npm test` exists and passes

## P5.2 Add CI Workflow

Add GitHub Actions (or equivalent):
- install
- lint
- tests

Acceptance:
- PR checks block regressions

---

# P6: Documentation For External Agents

Update `AGENTS.md` + `/api/system/agent` manifest:
- include new execution + runs endpoints
- document idempotency + approvals + policy
- include example flows:
  - "create campaign -> plan -> propose -> approve -> execute -> monitor"

Acceptance:
- another agent can operate purely via manifest + curl examples

---

# Suggested Milestones

1. Milestone A (Agent-safe): idempotency + execution endpoints + runs model
2. Milestone B (Human-in-loop): approvals gating + UI to approve/execute
3. Milestone C (Ops-grade): policy/quotas + analytics + conversation inbox
4. Milestone D (Hootsuite-like): calendar/queues + drafts/templates

