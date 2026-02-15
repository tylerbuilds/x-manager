# X Manager

X Manager is a self-hosted app for:
- connecting up to two X accounts
- creating and scheduling posts
- bulk importing posts from CSV
- auto-posting scheduled content via cron
- finding relevant recent topics to reply to
- checking X usage data to track pay-as-you-go consumption

This repo is bootstrapped from [`dylee9/open-platter`](https://github.com/dylee9/open-platter) and adapted for current X API usage (`api.x.com`) plus PAYG-aware workflows.

## What was reused vs added

### Reused boilerplate
- Next.js app shell and dashboard UI
- OAuth connection flow
- SQLite + Drizzle schema and scheduler CRUD APIs
- Cron worker pattern for publishing scheduled posts

### Added in this repo
- `X_*` env support with backward compatibility for `TWITTER_*`
- `api.x.com` base URL defaults
- optional scheduled **reply** support (`reply_to_tweet_id`)
- CSV import API + UI preview/validation flow
- CLI CSV import command (`npm run import:csv`)
- in-app scheduler auto-start (no second process required by default)
- auto schema initialization on startup (no manual migration command required)
- readiness API + dashboard panel (`/api/system/readiness`)
- topic discovery API (`/api/discovery/topics`) with engagement+recency ranking
- discovery cache table (`topic_search_cache`) to reduce repeated paid calls
- usage endpoint proxy (`/api/usage/tweets`) to inspect `/2/usage/tweets`
- Topic Discovery UI panel in the dashboard

## Prerequisites

- Node.js 20-25
- npm
- X developer app credentials

## X App Setup

1. Create an app in the X developer console.
2. Enable OAuth 1.0a user auth.
3. Set app permissions to **Read and write**.
4. Use a **Web App** (not Desktop) if you want redirect-based auth. If your app is Desktop, X requires the PIN ("oob") flow; X Manager will prompt you to paste the verifier after authorizing.
5. Add callback URL:
   - `http://localhost:3999/api/twitter/auth/callback`
6. Collect:
   - API key
   - API secret
   - app-only bearer token

## Environment

Environment variables are optional for core setup. You can configure credentials in-app from the **First-Run Setup** card.

Use `env.example` only when you want to override saved settings at runtime:

```bash
cp env.example .env.local
```

Values from environment variables take precedence over saved setup values.

If you want OpenClaw (or another external bot) to publish immediately through this app, set:

```bash
OPENCLAW_BRIDGE_TOKEN=replace-with-a-long-random-secret
OPENCLAW_BRIDGE_SIGNING_SECRET=replace-with-a-second-long-random-secret
OPENCLAW_BRIDGE_REQUIRE_SIGNATURE=true
OPENCLAW_BRIDGE_ALLOWED_SLOTS=1
OPENCLAW_BRIDGE_MEDIA_HOST_ALLOWLIST=swarmsignal.net
```

## Install and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3999](http://localhost:3999).

If you want the dev server to stay running after you close your terminal/session:

```bash
npm run dev:daemon
npm run dev:status
npm run dev:logs
npm run dev:stop
```

Default behavior:
- Database tables are auto-created on first run.
- Scheduler runs in-app automatically every 60 seconds.
- You can paste credentials into the in-app setup panel, then connect your X account once.
- You can paste credentials into the in-app setup panel, then connect account slot `1` and/or `2`.

Optional dedicated worker mode:

```bash
DISABLE_IN_APP_SCHEDULER=true npm run cron:run
```

## CSV Import (UI)

Open the **CSV Tweet Import** card in the dashboard and upload your file.

Supported columns:
- `text` (or `tweet`, `post`, `content`) - required
- `scheduled_time` (or `scheduled_at`, `date`) - optional
- `community_id` - optional
- `reply_to_tweet_id` - optional
- `account_slot` (`1` or `2`) - optional

If a row has no schedule, X Manager auto-assigns times using your selected interval/start time.

Example:

```csv
text,scheduled_time,community_id,reply_to_tweet_id,account_slot
"Shipping a new feature today!",2026-02-11 09:30,,,1
"Agree with this take on agent tooling",,123456,1893289302711484472,2
"Weekly growth notes are live",2026-02-12T14:00:00,,,1
```

## CSV Import (CLI)

```bash
npm run import:csv -- --file ./tweets.csv --dry-run
npm run import:csv -- --file ./tweets.csv --interval-minutes 45 --start-time "2026-02-10T09:00:00"
npm run import:csv -- --file ./tweets.csv --account-slot 2
```

CLI flags:
- `--file` required
- `--dry-run` optional
- `--interval-minutes` optional (default `60`)
- `--start-time` optional (used when schedule is missing)
- `--reschedule-past false` optional (default is true)
- `--account-slot` optional (default `1`; row-level `account_slot` overrides it)

## PAYG Cost Controls in this repo

- Topic discovery result cap: max 25 posts/request
- Discovery cache TTL: 15 minutes (`topic_search_cache` table)
- Usage visibility route: `GET /api/usage/tweets?days=7` (`days` supports `1-90`)

These guardrails are designed to avoid unnecessary repeated billable reads while still keeping discovery current.

## Key API Routes

- `GET /api/system/readiness`
- `GET/PUT /api/system/settings`
- `POST /api/twitter/auth/start`
- `GET /api/twitter/auth/callback`
- `GET/DELETE /api/user` (multi-account slot status + disconnect)
- `GET/POST/DELETE /api/scheduler/posts`
- `PUT/DELETE /api/scheduler/posts/:id`
- `GET /api/discovery/topics?keywords=ai,agents&limit=10`
- `GET /api/usage/tweets?days=7`
- `POST /api/scheduler/import-csv`
- `POST /api/bridge/openclaw/post` (requires `Authorization: Bearer <OPENCLAW_BRIDGE_TOKEN>`)

## OpenClaw Bridge API

Use this route for bot-triggered immediate posting:

```bash
curl -sS -X POST http://127.0.0.1:3999/api/bridge/openclaw/post \
  -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "content": "Bridge post from OpenClaw",
    "account": "swarm_signal",
    "images": ["/uploads/example.jpg"],
    "dryRun": false
  }'
```

For signed requests (recommended), generate:
- `x-openclaw-timestamp`: current unix timestamp in seconds
- `x-openclaw-signature`: `HMAC_SHA256(OPENCLAW_BRIDGE_SIGNING_SECRET, "<timestamp>.<raw-json-body>")`

Example signed call:
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

Supported body fields:
- Text: `text` or `content` or `message` or `tweet_text` (one required)
- Account target: `account_slot|slot` or `account|handle|username` (default slot `1`)
- Media: `media_urls|mediaUrls|images` (up to 4; supports `/uploads/...` and public `http/https` image URLs)
- Optional: `community_id|communityId`, `reply_to_tweet_id|replyToTweetId|reply_to`
- Dry-run toggle: `dry_run|dryRun|simulate` (`true` validates payload/auth without publishing)

Security controls:
- Token auth is required.
- Optional HMAC request signing + timestamp verification + replay protection.
- Default allowed slot is `1` (`OPENCLAW_BRIDGE_ALLOWED_SLOTS`).
- Per-client rate limiting (`OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN`).
- Media SSRF protections (private-network blocking, redirect checks, optional host allowlist).

## Data Model Changes

- `scheduled_posts.reply_to_tweet_id` added
- `scheduled_posts.account_slot` added
- new table: `x_accounts` (slot-based account storage: 1 or 2)
- new table: `topic_search_cache`
- new table: `app_settings` (stores in-app setup values)

## Notes

- Media upload still uses the legacy upload host (`upload.twitter.com`) by default; override with `X_UPLOAD_API_BASE_URL` if needed.
- Topic discovery requires `X_BEARER_TOKEN` (app auth), while posting/scheduling requires user OAuth credentials.
- Readiness status is visible in-app via the **System Readiness** panel.
