---
name: x-manager
description: "Complete X (Twitter) growth manager - search, browse, post, schedule, and reply. Use when reading tweets, searching topics, posting content, threads, media, or engaging with X community. Supports X API v2 search and secure bridge publishing."
---

# X Growth Manager for Swarm Signal

**Goal:** Complete X management - search, browse, post, schedule, reply, and grow.

## Features

### 🔍 Search & Browse (X API v2)
- **Search tweets** via X API v2 with keywords/hashtags
- **Read tweet details** by ID or URL
- **Get conversation threads** for context
- **Find engagement opportunities** to reply to relevant tweets

### 📝 Post & Schedule (Bridge API)
- **Immediate posting** via secure OpenClaw bridge API
- **Schedule tweets** for future publishing
- **Upload media** (images, videos, GIFs)
- **Create threads** from article URLs
- **Reply to tweets** with context awareness
- **CSV import** for bulk scheduling

## 🔍 Search & Browse (Bridge Discovery API)

**Recommended**: Use the bridge discovery API instead of direct X API v2 calls.
The bridge handles authentication, caching, and relevance scoring automatically.

### Discovery API Endpoint
```
http://127.0.0.1:3999/api/discovery/topics
```

### Search for Topics
```bash
# Search for tweets about AI/ML (up to 25 results, default 10)
curl -s "http://127.0.0.1:3999/api/discovery/topics?keywords=ai,machine%20learning,neural%20networks&limit=10&lang=en" | jq '.'
```

**Parameters**:
- `keywords` - Comma-separated keywords (required)
- `limit` - Number of results (1-25, default 10)
- `lang` - Language filter (default: 'en')

**Response**:
```json
{
  "fetchedAt": "2026-02-12T23:30:00.000Z",
  "query": "(\"ai\" OR \"machine learning\" OR \"neural networks\") lang:en -is:retweet",
  "keywords": ["ai", "machine learning", "neural networks"],
  "source": "live",  // or "cache" if from cache (15min TTL)
  "topics": [
    {
      "id": "1893289302711484472",
      "text": "Building AI agents? Here's what nobody tells you...",
      "url": "https://x.com/username/status/1893289302711484472",
      "author": {
        "id": "123456789",
        "username": "techuser",
        "name": "Tech User",
        "verified": true
      },
      "createdAt": "2026-02-12T20:00:00.000Z",
      "language": "en",
      "metrics": {
        "likes": 1247,
        "replies": 42,
        "reposts": 89,
        "quotes": 15
      },
      "relevanceScore": 23.45,
      "suggestedReplyStarter": "Interesting take on ai. I agree with parts of \"Building AI agents? Here's what nobody tells you...\" and would add: "
    }
  ],
  "meta": {
    "result_count": 5,
    "newest_id": "189328930271484472",
    "oldest_id": "189328930271484400"
  }
}
```

### Direct X API v2 (Optional - Requires X_BEARER_TOKEN)

If you need direct X API v2 access (not recommended - use bridge discovery instead):

**Environment Variables**:
- `X_BEARER_TOKEN` - X API v2 Bearer token for search/read operations
- `X_API_BASE_URL` - (optional, default: `https://api.x.com/2`)

### Search Tweets (Direct API)
```bash
curl -s "https://api.x.com/2/search?q=ai&tweet.fields=created_at,author_id,public_metrics&max_results=10" \
  -H "Authorization: Bearer $X_BEARER_TOKEN"
```

### Reply to Tweet (Combines Search + Bridge)
```bash
# 1. Search for relevant tweets
RESULTS=$(curl -s "https://api.x.com/2/search?q=ai&max_results=5" \
  -H "Authorization: Bearer $X_BEARER_TOKEN" | jq -r '.data[] | .id')

# 2. Reply via bridge
for TWEET_ID in $RESULTS; do
  BODY="{\"text\":\"Great insights!\",\"reply_to_tweet_id\":\"$TWEET_ID\",\"account\":\"swarm_signal\",\"dryRun\":false}"
  TS=$(date +%s)
  SIG=$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$OPENCLAW_BRIDGE_SIGNING_SECRET" -hex | awk '{print $2}')

  curl -sS -X POST "$XM_BRIDGE_URL" \
    -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
    -H "x-openclaw-timestamp: $TS" \
    -H "x-openclaw-signature: $SIG" \
    -H 'Content-Type: application/json' \
    -d "$BODY"
done
```

## 📝 Post & Schedule (Bridge API)

### Environment Variables (Required)
These must be available in execution environment:

- `XM_BRIDGE_URL` (default: `http://127.0.0.1:3999/api/bridge/openclaw/post`)
- `OPENCLAW_BRIDGE_TOKEN` - Bearer token for bridge authorization
- `OPENCLAW_BRIDGE_SIGNING_SECRET` - HMAC signing secret

### Bridge Endpoint

**POST** `${XM_BRIDGE_URL}`

### Headers

```
Authorization: Bearer ${OPENCLAW_BRIDGE_TOKEN}
Content-Type: application/json
x-openclaw-timestamp: <unix-seconds>
x-openclaw-signature: <hex hmac sha256>
```

### Signature Calculation

```bash
ts = current unix timestamp in seconds
rawBody = exact JSON string sent in HTTP body
signature = HMAC_SHA256(OPENCLAW_BRIDGE_SIGNING_SECRET, `${ts}.${rawBody}`) as lowercase hex
```

### Request Body

Supported fields:
- **Text content** (one required):
  - `text` or `content` or `message` or `tweet_text`
- **Account target** (optional, defaults to slot 1):
  - `account_slot` or `slot` or `account` or `handle` or `username`
- **Media** (optional, up to 4 images):
  - `media_urls` or `mediaUrls` or `images`
  - Supports `/uploads/...` paths and public `http/https` URLs
- **Post options** (optional):
  - `community_id` or `communityId` - for Community Notes
  - `reply_to_tweet_id` or `replyToTweetId` or `reply_to` - for replies
- **Dry-run toggle** (optional):
  - `dry_run` or `dryRun` or `simulate` - `true` validates without publishing

## Example Usage

### 1. Always Start with Dry Run

```bash
# First, validate with dry run
BODY='{"content":"Test post","account":"swarm_signal","dryRun":true}'
TS="$(date +%s)"
SIG="$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$OPENCLAW_BRIDGE_SIGNING_SECRET" -hex | awk '{print $2}')"

curl -sS -X POST "$XM_BRIDGE_URL" \
  -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
  -H "x-openclaw-timestamp: $TS" \
  -H "x-openclaw-signature: $SIG" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
```

### 2. Real Publish (After Dry Run Succeeds)

```bash
# Same body, but dryRun: false
BODY='{"content":"Live post!","account":"swarm_signal","dryRun":false}'
TS="$(date +%s)"
SIG="$(printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$OPENCLAW_BRIDGE_SIGNING_SECRET" -hex | awk '{print $2}')"

curl -sS -X POST "$XM_BRIDGE_URL" \
  -H "Authorization: Bearer $OPENCLAW_BRIDGE_TOKEN" \
  -H "x-openclaw-timestamp: $TS" \
  -H "x-openclaw-signature: $SIG" \
  -H 'Content-Type: application/json' \
  -d "$BODY"
```

### 3. With Media

```bash
BODY='{"text":"Check this out!","images":["https://swarmsignal.net/image.png"],"dryRun":true}'
# ... rest of signed request
```

### 4. Reply to Tweet

```bash
BODY='{"text":"Agreed!","reply_to_tweet_id":"1893289302711484472","dryRun":false}'
# ... rest of signed request
```

## Response Format

Success:
```json
{
  "success": true,
  "tweetId": "1893289302711484472",
  "tweetUrl": "https://x.com/swarm_signal/status/1893289302711484472"
}
```

Error:
```json
{
  "success": false,
  "error": "Invalid signature"
}
```

## Security Rules

1. **Never print or log** `OPENCLAW_BRIDGE_TOKEN`, `OPENCLAW_BRIDGE_SIGNING_SECRET`, or `X_BEARER_TOKEN` in any output.
2. Always send signed requests with HMAC-SHA256 for posting.
3. Always run a dry run first to validate payload/auth before real publish.
4. Use exactly the same raw JSON string for signature and request body.
5. Default to `@swarm_signal` (slot 1) unless explicitly instructed otherwise.

## Account Policy

1. Post only as `swarm_signal` (account_slot 1).
2. Do not post as `getboski` (account_slot 2) unless explicitly instructed and bridge allowlist is updated.

## Security Controls

- Token auth is required for all operations
- HMAC request signing with replay protection (posting only)
- Default allowed slot is `1` (`OPENCLAW_BRIDGE_ALLOWED_SLOTS`)
- Per-client rate limiting (`OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN`)
- Media SSRF protections (private-network blocking, redirect checks, optional host allowlist)

## Best Practices

1. **Always dry run first** - Validate payload and auth before real publish
2. **Check account mapping** - `swarm_signal` = slot 1, `getboski` = slot 2
3. **Handle rate limits** - Bridge will return 429 if limit exceeded
4. **Verify media URLs** - Ensure images are accessible before posting
5. **Never log secrets** - Redact tokens and secrets from all output
6. **Combine search + reply** - Find relevant tweets and reply with context

## Troubleshooting

| Error | Solution |
|-------|----------|
| "Invalid signature" | Check timestamp, verify exact JSON match |
| "Account not connected" | Check slot status: `curl http://127.0.0.1:3999/api/system/readiness` |
| "Rate limit exceeded" | Wait before retrying |
| "Unauthorized" | Check `OPENCLAW_BRIDGE_TOKEN` or `X_BEARER_TOKEN` is set |
| Media upload fails | Verify media URLs are publicly accessible |
| Search returns 401 | Check `X_BEARER_TOKEN` is valid and has read permissions |

## Test the Setup

```bash
# Test bridge connectivity
cd /mnt/data/projects/x-manager
./test-bridge.sh

# Test X API search
curl -s "https://api.x.com/2/search?q=test&max_results=1" \
  -H "Authorization: Bearer $X_BEARER_TOKEN"
```
