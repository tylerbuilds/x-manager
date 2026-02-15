# AGENTS

This repo runs a local web UI + API for managing X (Twitter) account connections and scheduling posts.

## Start / Stop / Logs

- Start or keep running (port 3999): `npm run dev:ensure`
- Status: `npm run dev:status`
- Logs (tail): `npm run dev:logs`
- Stop: `npm run dev:stop`

Shortcut CLI (agent-friendly):
- `./xm start|status|logs|stop|readiness|manifest|list|schedule|upload|thread|create-thread`

Global service manager (installed to `~/bin`):
- `x-manager start|stop|restart|status|logs|url|manifest`
- `start-x-manager` (alias)

Web UI:
- `http://127.0.0.1:3999`

Agent/LLM manifest:
- `GET /api/system/agent` (machine-readable list of endpoints + curl examples)

Notes:
- The dev server binds to `127.0.0.1` by default for safety. If you need remote access, use SSH port forwarding:
  `ssh -L 3999:127.0.0.1:3999 <host>`

## X Account Connection (Slots)

X accounts are stored in slots (`1` and `2`). The system can be configured to require only 1 connected slot.

OAuth modes:
- Web callback mode (normal)
- Desktop/PIN ("oob") mode (used when X app is configured as a Desktop app; you'll paste a verifier/PIN)

UI: use the connector panel and follow the prompts.

## Scheduling API (What Agents Should Use)

### Dedupe

When scheduling a post, x-manager will skip creating a duplicate if:
- Same X slot, AND
- Same canonical URL, AND
- Same normalized copy, AND
- Existing status is `scheduled`

In this case the API returns the existing post with `skipped: true`.

### Schedule A Single Post (reply + images supported)

`POST /api/scheduler/posts` (multipart/form-data)

Required fields:
- `text`
- `scheduled_time` (ISO date string)

Optional fields:
- `account_slot` (1 or 2, default 1)
- `community_id`
- `reply_to_tweet_id` (schedule as a reply)
- `files` (repeatable, up to 4)
- `source_url` (URL override for dedupe/canonicalization)

Example:
```bash
curl -sS -X POST http://127.0.0.1:3999/api/scheduler/posts \
  -F account_slot=1 \
  -F scheduled_time="2026-02-10T09:00:00Z" \
  -F text="Hello https://example.com" \
  -F files=@/absolute/path/to/image.jpg
```

### Upload Media (then reference it in thread scheduling)

`POST /api/scheduler/media` (multipart/form-data)

```bash
curl -sS -X POST http://127.0.0.1:3999/api/scheduler/media \
  -F files=@/absolute/path/to/image1.jpg \
  -F files=@/absolute/path/to/image2.png
```

Response:
```json
{ "mediaUrls": ["/uploads/...", "/uploads/..."] }
```

### Schedule A Thread

Preferred: `POST /api/scheduler/thread` (JSON)

```bash
curl -sS -X POST http://127.0.0.1:3999/api/scheduler/thread \
  -H 'Content-Type: application/json' \
  -d '{
    "account_slot": 1,
    "scheduled_time": "2026-02-10T09:00:00Z",
    "dedupe": true,
    "reply_to_tweet_id": null,
    "tweets": [
      { "text": "Thread part 1 https://example.com", "media_urls": ["/uploads/file.jpg"] },
      { "text": "Thread part 2" }
    ]
  }'
```

Threads are stored as multiple rows in `scheduled_posts` with:
- `thread_id` (same across the thread)
- `thread_index` (0-based order)

Posting behavior:
- Tweet `thread_index=0` posts normally (or as a reply if `reply_to_tweet_id` is set).
- Tweet `thread_index>0` automatically replies to the previous tweet in the thread after it has posted.

### Create Thread From Article (agent skill path)

`POST /api/agent/create-thread` (JSON)

Use this to ingest an article URL, extract quote candidates, pull article images into `/uploads`, build a thread draft, and optionally schedule in one call.

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/create-thread \
  -H 'Content-Type: application/json' \
  -d '{
    "article_url": "https://swarmsignal.net/example-post/",
    "account_slot": 1,
    "max_tweets": 6,
    "include_images": true,
    "schedule": false
  }'
```

One-shot schedule:
```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/create-thread \
  -H 'Content-Type: application/json' \
  -d '{
    "article_url": "https://swarmsignal.net/example-post/",
    "account_slot": 1,
    "scheduled_time": "2026-02-12T09:00:00Z",
    "schedule": true,
    "dedupe": true
  }'
```

### OpenClaw Bridge (Immediate Post)

`POST /api/bridge/openclaw/post` (JSON)

Purpose: allow external bots (like OpenClaw) to publish immediately via a connected X slot.

Auth:
- Set `OPENCLAW_BRIDGE_TOKEN` in `.env.local`
- Send `Authorization: Bearer <OPENCLAW_BRIDGE_TOKEN>`
- Recommended: set `OPENCLAW_BRIDGE_SIGNING_SECRET` and sign every request with:
  - `x-openclaw-timestamp`
  - `x-openclaw-signature` = HMAC_SHA256(secret, `<timestamp>.<raw-json-body>`)

Example:
```bash
BODY='{"content":"Bridge post from OpenClaw","account":"swarm_signal","images":[],"dryRun":true}'
TS="$(date +%s)"
SIG="$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$OPENCLAW_BRIDGE_SIGNING_SECRET" -hex | awk '{print $2}')"

curl -sS -X POST http://127.0.0.1:3999/api/bridge/openclaw/post \
  -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
  -H "x-openclaw-timestamp: $TS" \
  -H "x-openclaw-signature: $SIG" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
```

Notes:
- Text aliases: `text` | `content` | `message` | `tweet_text`.
- Account aliases: `account_slot` | `slot` OR `account` | `handle` | `username`.
- Media aliases: `media_urls` | `mediaUrls` | `images` (also `image_urls`, `files`).
- `media_urls` supports up to 4 items (`/uploads/...` or public `http/https` image URLs).
- If `OPENCLAW_BRIDGE_TOKEN` is missing, endpoint returns `503` until configured.
- Default bridge slot allowlist is slot `1` (`OPENCLAW_BRIDGE_ALLOWED_SLOTS=1`).

### List / Delete Scheduled Posts

- List: `GET /api/scheduler/posts` (optional `?account_slot=1|2`)
- Delete one: `DELETE /api/scheduler/posts/:id`
- Delete all: `DELETE /api/scheduler/posts`

## Link Previews vs Attached Images

- Link previews are generated by X when a URL is present in the tweet text.
- If you attach images, X will usually show your images instead of the link card.
- X does not provide an API to keep the card but replace its preview image; attaching media is the practical workaround.

## Agentic Execution Engine

Execute campaign tasks individually or in batches.

### Execute Single Task

`POST /api/agent/tasks/:id/execute` (JSON)

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/tasks/1/execute \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: task-1-exec-20260215' \
  -d '{"dry_run": false}'
```

Fields:
- `dry_run` (boolean, optional): Simulate execution without making real API calls
- `Idempotency-Key` (header, optional): Prevent duplicate executions

### Execute Campaign

`POST /api/agent/campaigns/:id/execute` (JSON)

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/campaigns/1/execute \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": false, "max_tasks": 5}'
```

Fields:
- `dry_run` (boolean, optional): Simulate execution
- `max_tasks` (number, optional): Limit how many tasks to execute in one call

### List Execution Runs

`GET /api/agent/runs`

```bash
curl -sS 'http://127.0.0.1:3999/api/agent/runs?campaign_id=1&status=completed'
```

Query params:
- `campaign_id` (optional): Filter by campaign
- `status` (optional): Filter by run status

### Get Run Details

`GET /api/agent/runs/:id`

```bash
curl -sS http://127.0.0.1:3999/api/agent/runs/1
```

Returns detailed run information including all execution steps.

## Scheduled Actions

Schedule engagement actions (likes, replies, DMs, reposts) to be executed at specific times.

### List Scheduled Actions

`GET /api/actions`

```bash
curl -sS 'http://127.0.0.1:3999/api/actions?account_slot=1&status=pending'
```

Query params:
- `account_slot` (optional): Filter by slot
- `status` (optional): Filter by status (pending, completed, failed, cancelled)

### Schedule Action

`POST /api/actions` (JSON)

**Like:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "action_type": "like",
    "account_slot": 1,
    "scheduled_time": "2026-02-16T10:00:00Z",
    "target_tweet_id": "1234567890"
  }'
```

**Reply:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "action_type": "reply",
    "account_slot": 1,
    "scheduled_time": "2026-02-16T10:00:00Z",
    "target_tweet_id": "1234567890",
    "text": "Great point!"
  }'
```

**DM:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "action_type": "dm",
    "account_slot": 1,
    "scheduled_time": "2026-02-16T10:00:00Z",
    "target_user_id": "12345",
    "text": "Thanks for connecting."
  }'
```

**Repost:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/actions \
  -H 'Content-Type: application/json' \
  -d '{
    "action_type": "repost",
    "account_slot": 1,
    "scheduled_time": "2026-02-16T10:00:00Z",
    "target_tweet_id": "1234567890"
  }'
```

### Get Action Details

`GET /api/actions/:id`

```bash
curl -sS http://127.0.0.1:3999/api/actions/1
```

### Cancel Action

`DELETE /api/actions/:id`

```bash
curl -sS -X DELETE http://127.0.0.1:3999/api/actions/1
```

Only works for actions with `pending` status.

### Retry Failed Action

`POST /api/actions/retry` (JSON)

```bash
curl -sS -X POST http://127.0.0.1:3999/api/actions/retry \
  -H 'Content-Type: application/json' \
  -d '{"action_id": 1}'
```

## Policy Engine

Control rate limits and time windows for each account slot.

### Get Policy

`GET /api/agent/policy`

```bash
curl -sS 'http://127.0.0.1:3999/api/agent/policy?slot=1'
```

Returns current quotas and allowed hours for the slot.

### Update Policy

`PUT /api/agent/policy` (JSON)

```bash
curl -sS -X PUT http://127.0.0.1:3999/api/agent/policy \
  -H 'Content-Type: application/json' \
  -d '{
    "account_slot": 1,
    "max_posts_per_hour": 5,
    "max_replies_per_hour": 10,
    "max_likes_per_hour": 20,
    "max_dms_per_hour": 5,
    "allowed_hours": [9,10,11,12,13,14,15,16,17]
  }'
```

### Check Policy

`POST /api/agent/policy` (JSON)

Check if an action is currently allowed by policy:

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/policy \
  -H 'Content-Type: application/json' \
  -d '{
    "account_slot": 1,
    "action_type": "post"
  }'
```

Returns `{"allowed": true|false, "reason": "..."}`.

## Usage & Monitoring

### List API Call Logs

`GET /api/usage/api-calls`

```bash
curl -sS 'http://127.0.0.1:3999/api/usage/api-calls?start_date=2026-02-01&end_date=2026-02-15'
```

Query params:
- `start_date` (optional): Filter from date (ISO string)
- `end_date` (optional): Filter to date (ISO string)
- `account_slot` (optional): Filter by slot
- `endpoint` (optional): Filter by endpoint path

Returns logs with aggregation summary (total calls, success rate, etc.).

## Drafts & Templates

### Drafts

**List Drafts:**
```bash
curl -sS 'http://127.0.0.1:3999/api/drafts?account_slot=1'
```

**Create Draft:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/drafts \
  -H 'Content-Type: application/json' \
  -d '{
    "account_slot": 1,
    "content": "Draft tweet content",
    "metadata": {"source": "agent", "topic": "launch"}
  }'
```

**Get Draft:**
```bash
curl -sS http://127.0.0.1:3999/api/drafts/1
```

**Update Draft:**
```bash
curl -sS -X PUT http://127.0.0.1:3999/api/drafts/1 \
  -H 'Content-Type: application/json' \
  -d '{"content": "Updated draft content"}'
```

**Delete Draft:**
```bash
curl -sS -X DELETE http://127.0.0.1:3999/api/drafts/1
```

### Templates

**List Templates:**
```bash
curl -sS http://127.0.0.1:3999/api/templates
```

**Create Template:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/templates \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Welcome DM",
    "content": "Hi {{name}}, thanks for following!",
    "variables": ["name"]
  }'
```

**Update Template:**
```bash
curl -sS -X PUT http://127.0.0.1:3999/api/templates/1 \
  -H 'Content-Type: application/json' \
  -d '{"content": "Hi {{name}}, welcome to our community!"}'
```

**Delete Template:**
```bash
curl -sS -X DELETE http://127.0.0.1:3999/api/templates/1
```

## Engagement Inbox Enhancements

### Tags

**List Tags:**
```bash
curl -sS http://127.0.0.1:3999/api/engagement/inbox/1/tags
```

**Add Tag:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/engagement/inbox/1/tags \
  -H 'Content-Type: application/json' \
  -d '{"tag": "important"}'
```

**Remove Tag:**
```bash
curl -sS -X DELETE 'http://127.0.0.1:3999/api/engagement/inbox/1/tags?tag=important'
```

### Notes

**List Notes:**
```bash
curl -sS http://127.0.0.1:3999/api/engagement/inbox/1/notes
```

**Add Note:**
```bash
curl -sS -X POST http://127.0.0.1:3999/api/engagement/inbox/1/notes \
  -H 'Content-Type: application/json' \
  -d '{"text": "Follow up next week"}'
```

### Assignment

**Assign Inbox Item:**
```bash
curl -sS -X PUT http://127.0.0.1:3999/api/engagement/inbox/1/assign \
  -H 'Content-Type: application/json' \
  -d '{"assigned_to": "team-support"}'
```

### Conversation View

**Get Conversations:**
```bash
curl -sS http://127.0.0.1:3999/api/engagement/inbox/conversations
```

Returns inbox items grouped by conversation thread.

## Start On Login (Persist After Reboot)

Preferred (same pattern as your other services): systemd user service
- `npm run install:systemd-user`

Alternative (GNOME autostart):
- `npm run install:autostart`

Systemd option installs `~/.config/systemd/user/x-manager.service` and enables it.
