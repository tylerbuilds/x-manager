---
name: x-manager
description: "Publish posts to X (Twitter) via X Manager's secure OpenClaw bridge API. Use when posting content, threads, or media to X. Supports immediate publishing, dry-run validation, and signed requests."
---

# X Bridge Publisher Agent for Swarm Signal

**Goal:** Publish posts to x-manager's secure bridge API.

## Current Account Policy

1. Post only as `swarm_signal` (account_slot 1).
2. Do not post as `getboski` (account_slot 2) unless explicitly instructed and bridge allowlist is updated.

## Security Rules

1. **Never print or log** `OPENCLAW_BRIDGE_TOKEN` or `OPENCLAW_BRIDGE_SIGNING_SECRET` in any output.
2. Always send signed requests with HMAC-SHA256.
3. Always run a dry run first, then real publish.
4. Use exactly the same raw JSON string for signature and request body.

## Environment Variables (Required)

These must be available in the execution environment:

- `XM_BRIDGE_URL` (default: `http://127.0.0.1:3999/api/bridge/openclaw/post`)
- `OPENCLAW_BRIDGE_TOKEN` - Bearer token for authorization
- `OPENCLAW_BRIDGE_SIGNING_SECRET` - HMAC signing secret

## Bridge Endpoint

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

## Request Body

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

## Security Controls

- Token auth is required
- HMAC request signing with replay protection
- Default allowed slot is `1` (configurable via `OPENCLAW_BRIDGE_ALLOWED_SLOTS`)
- Per-client rate limiting (`OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN`)
- Media SSRF protections (private-network blocking, redirect checks, optional host allowlist)

## Best Practices

1. **Always dry run first** - Validate payload and auth before real publish
2. **Check account mapping** - `swarm_signal` = slot 1, `getboski` = slot 2
3. **Handle rate limits** - Bridge will return 429 if limit exceeded
4. **Verify media URLs** - Ensure images are accessible before posting
5. **Never log secrets** - Redact tokens and secrets from all output

## Troubleshooting

### "Invalid signature"
- Check timestamp is current (within 5 minutes)
- Verify rawBody string matches exactly what's sent in HTTP body
- Ensure signing secret matches bridge configuration

### "Account not connected"
- Check slot status: `curl http://127.0.0.1:3999/api/system/readiness`
- Reconnect account via X Manager UI if needed

### "Rate limit exceeded"
- Wait before retrying
- Check `OPENCLAW_BRIDGE_RATE_LIMIT_PER_MIN` setting

### Media upload fails
- Verify media URLs are publicly accessible
- Check file size limits (X: 5MB per photo, 15MB per video)
- Ensure media host is in allowlist if configured
