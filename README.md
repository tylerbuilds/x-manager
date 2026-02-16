# X-Manager

> The open-source X command center -- schedule, engage, automate.

**Alpha v0.1.3** | MIT License | Built with Next.js + SQLite

---

## What Is This?

X-Manager is a self-hosted X/Twitter management platform that treats **agents and humans as first-class citizens**. Schedule content, bulk-import from CSV, track analytics, manage an engagement inbox, and expose a secure Bridge API so your bots and AI agents can publish autonomously -- all from a single Next.js app backed by SQLite.

Zero external dependencies. Full encryption at rest. Runs on a $5 VPS.

**What you get out of the box:**

- **Schedule posts** -- visual calendar, bulk CSV import, or queue-based publishing
- **Manage 2 accounts** side-by-side from one dashboard
- **Auto-publish** on schedule via built-in cron (no extra processes needed)
- **Engagement inbox** -- mentions, DMs, tags, notes, and quick-reply templates
- **Topic discovery** -- find conversations to engage with, ranked by engagement + recency
- **Analytics** -- impressions, likes, retweets, best posting times, API cost tracking
- **AI campaigns** -- define objectives, let agents plan and execute with human approval gates
- **Bridge API** -- secure endpoint for external bots to publish through your accounts

### Why Self-Hosted?

Your API keys and OAuth tokens **never leave your machine**. All credentials are encrypted at rest with AES-256-GCM. No third-party SaaS sees your data. You own everything.

---

## Quick Start

### 1. Prerequisites

X-Manager is built and tested on **Ubuntu 22.04 / 24.04** (any modern Linux distro works). It also runs on macOS and WSL2.

You need:

| Requirement | Version | How to Install (Ubuntu) |
|-------------|---------|------------------------|
| **Node.js** | 20 - 25 | `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo bash - && sudo apt install -y nodejs` |
| **npm** | 10+ | Comes with Node.js |
| **build-essential** | any | `sudo apt install -y build-essential python3` (needed for `better-sqlite3` native module) |
| **Git** | any | `sudo apt install -y git` |

**Full Ubuntu setup from scratch:**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# Install build tools (required for native SQLite module)
sudo apt install -y build-essential python3 git

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2. Clone and Install

```bash
git clone https://github.com/tylerbuilds/x-manager.git
cd x-manager
npm install
```

### 3. Set Up Your X Developer App

X now uses a **pay-per-use credit system** (launched January 2026) instead of fixed monthly tiers. You buy credits upfront and pay per API call -- roughly **$0.005 per post read**, **$0.01 per post created**, and **$0.01 per user lookup**. Only successful responses are billed, and duplicate requests on the same day are deduplicated. This makes it very affordable for personal and small-scale use. X-Manager includes built-in cost controls (caching, result caps, usage monitoring) to help you stay on top of spending.

To get started:

1. Go to the [X Developer Portal](https://developer.x.com/en/portal/dashboard)
2. Create a new app (or use an existing one)
3. Enable **OAuth 1.0a** user authentication
4. Set app permissions to **Read and Write**
5. Choose **Web App** type (not Desktop)
6. Add this callback URL: `http://localhost:3999/api/twitter/auth/callback`
7. Note down your **API Key**, **API Secret**, and **Bearer Token**

### 4. Start X-Manager

```bash
npm run dev
```

Open **http://localhost:3999** in your browser.

On first run you'll see a **Setup Panel** where you can paste your X API credentials directly in the browser. No `.env` file needed for basic setup.

### 5. Connect Your X Account

Click the **Connect** button in the dashboard. You'll be redirected to X to authorize the app, then back to X-Manager with your account connected.

That's it. You're ready to schedule your first post.

---

## Features

### Content Scheduling

- Create posts with up to 4 images
- Schedule for specific dates/times or add to a queue
- Thread support (multi-post threads with automatic reply chaining)
- Reply-to support for targeting specific conversations
- Community post support

### Bulk CSV Import

Import dozens of posts at once from a CSV file, either via the web UI or CLI:

```csv
text,scheduled_time,community_id,reply_to_tweet_id,account_slot
"Shipping a new feature today!",2026-02-11 09:30,,,1
"Weekly notes are live",2026-02-12T14:00:00,,,1
```

**Column names are flexible** -- `text`, `tweet`, `post`, or `content` all work for the post body.

```bash
# CLI import with preview
npm run import:csv -- --file ./posts.csv --dry-run

# Import with custom scheduling
npm run import:csv -- --file ./posts.csv --interval-minutes 45 --start-time "2026-03-01T09:00:00"

# Target account slot 2
npm run import:csv -- --file ./posts.csv --account-slot 2
```

### Multi-Account Support

Connect up to **2 X accounts** (slot 1 and slot 2). Each account has its own OAuth credentials, and you can target posts to either account.

### Engagement Inbox

- View incoming mentions and DMs in one place
- Tag and categorize conversations
- Add internal notes
- Quick-reply with saved templates
- Track status (new, reviewed, replied, dismissed)

### Analytics Dashboard

- Post-level metrics: impressions, likes, retweets, replies, quotes, bookmarks
- Engagement trends over time
- Best posting times analysis
- API usage monitoring (great for PAYG cost awareness)

### Topic Discovery

Search for relevant conversations to engage with. Results are ranked by engagement + recency, with a 15-minute cache to keep API costs low.

### Agent Campaigns (Experimental)

Define campaign objectives and let an AI agent plan and execute tasks:
- Automated task breakdown (post, reply, DM, like, research)
- Human approval workflow for sensitive actions
- Durable run history with step-by-step logs
- Webhook notifications for external integrations

### Bridge API

Let external bots publish through X-Manager with full security:

```bash
curl -X POST http://localhost:3999/api/bridge/openclaw/post \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content": "Hello from my bot!", "account_slot": 1}'
```

Supports token auth, optional HMAC request signing, rate limiting, and SSRF protection.

---

## Configuration

### Environment Variables (Optional)

You can configure everything from the in-app Setup Panel. Environment variables are only needed if you want to override saved settings or lock down production deployments.

```bash
cp env.example .env.local
```

**Key variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `X_API_KEY` | _(in-app)_ | Your X app API key |
| `X_API_SECRET` | _(in-app)_ | Your X app API secret |
| `X_BEARER_TOKEN` | _(in-app)_ | App-only bearer token for discovery + usage |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3999` | OAuth callback base URL |
| `X_MANAGER_ADMIN_TOKEN` | _(none)_ | Password for the admin login screen |
| `X_MANAGER_ENCRYPTION_KEY` | _(auto in dev)_ | Encryption key for stored credentials |
| `X_MANAGER_REQUIRE_AUTH` | `true` | Require login to access the app |
| `SCHEDULER_INTERVAL_SECONDS` | `60` | How often the scheduler checks for posts to publish |
| `DISABLE_IN_APP_SCHEDULER` | `false` | Set `true` to use the standalone cron worker instead |

See `env.example` for the complete list with descriptions.

### Production Deployment

For production use, you **must** set:

```bash
X_MANAGER_ADMIN_TOKEN=your-strong-random-password
X_MANAGER_ENCRYPTION_KEY=your-32-byte-random-key
X_MANAGER_SESSION_SECRET=another-random-secret
X_MANAGER_STRICT_BOOT=true
NODE_ENV=production
```

Generate secure random values:

```bash
# Generate a 32-byte hex key
openssl rand -hex 32
```

---

## Running in Production

### Option A: Daemon Mode

```bash
npm run build
npm run dev:daemon    # Starts as a background process
npm run dev:status    # Check if it's running
npm run dev:logs      # Tail the logs
npm run dev:stop      # Stop the daemon
```

### Option B: Systemd Service (Recommended for Linux)

```bash
npm run install:systemd-user
```

This creates a user-level systemd service that auto-starts on boot.

### Option C: Standalone Cron Worker

If you want to separate the web UI from the scheduler:

```bash
# Terminal 1: Web UI only
DISABLE_IN_APP_SCHEDULER=true npm start

# Terminal 2: Dedicated scheduler
npm run cron:run
```

---

## Database

X-Manager uses **SQLite** -- no database server to install or configure. The database file lives at `var/x-manager.sqlite.db` and is created automatically on first run.

- **WAL mode** for concurrent read/write performance
- **Auto-migration** -- schema updates are applied automatically on startup
- **Encrypted credentials** -- API keys and OAuth tokens stored with AES-256-GCM

To back up your data, just copy the `var/` directory.

---

## API Reference

X-Manager exposes a REST API (all routes under `/api/`). Key endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/system/readiness` | Health check and system status |
| `POST` | `/api/system/auth/login` | Login with admin token |
| `POST` | `/api/twitter/auth/start` | Start OAuth flow |
| `GET/POST` | `/api/scheduler/posts` | List/create scheduled posts |
| `POST` | `/api/scheduler/import-csv` | Bulk import posts from CSV |
| `GET` | `/api/discovery/topics?keywords=ai,agents` | Search for topics |
| `GET` | `/api/usage/tweets?days=7` | X API usage stats |
| `GET` | `/api/analytics/overview` | Engagement analytics |
| `GET` | `/api/engagement/inbox` | Inbox items |
| `POST` | `/api/bridge/openclaw/post` | Bridge API for external bots |
| `GET/POST` | `/api/agent/campaigns` | Campaign management |

All endpoints require authentication when `X_MANAGER_REQUIRE_AUTH=true` (default).

---

## Development

```bash
# Start dev server with hot reload
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint
npm run lint
```

### Tech Stack

- **Next.js 14** (React 18) -- full-stack web framework
- **TypeScript** -- end-to-end type safety
- **SQLite** (better-sqlite3) -- zero-config embedded database
- **Drizzle ORM** -- type-safe database access
- **Tailwind CSS** -- utility-first styling
- **OAuth 1.0a** -- X API authentication
- **node-cron** -- scheduled task execution
- **Vitest** -- fast unit testing

---

## Cost Controls (PAYG)

X's API uses a pay-per-use credit system (~$0.005/read, ~$0.01/post). X-Manager is built to keep your costs low:

- **Discovery cache** -- 15-minute TTL prevents repeated billable search calls
- **Result caps** -- topic discovery limited to 25 results per request
- **Usage dashboard** -- monitor daily/weekly/monthly API consumption via `GET /api/usage/tweets?days=7`
- **Deduplication** -- scheduled post dedupe keys prevent accidental double-posts

---

## Security

See [SECURITY.md](SECURITY.md) for the full security policy.

**Highlights:**
- AES-256-GCM encryption for all stored credentials
- HMAC-signed sessions with configurable TTL
- SSRF protection on webhook delivery and media fetches
- Rate limiting on sensitive endpoints
- Production boot refuses to start without encryption configured

---

## Troubleshooting

### `better-sqlite3` fails to install

This native module needs C++ build tools:

```bash
sudo apt install -y build-essential python3
npm rebuild better-sqlite3
```

### Port 3999 already in use

```bash
# Find what's using the port
lsof -i :3999

# Or use a different port
PORT=4000 npm run dev
```

### OAuth callback fails

Make sure your X app's callback URL matches exactly:
`http://localhost:3999/api/twitter/auth/callback`

If you changed `NEXT_PUBLIC_APP_URL`, update the callback URL in your X app settings to match.

### Database locked errors

This can happen if multiple processes access the same SQLite file. Make sure only one instance of X-Manager is running, or use the scheduler lock mechanism.

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to your fork and open a Pull Request

---

## License

[MIT](LICENSE) -- see LICENSE file for details.
