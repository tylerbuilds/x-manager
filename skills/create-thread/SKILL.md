---
name: create-thread
description: Build and optionally schedule a media-aware X thread from an article URL. Use when you need to turn a swarmsignal.net (or other public) article into a quote-led thread with article images pulled into uploads and ready for scheduler posting.
---

# Create Thread Skill

Use `POST /api/agent/create-thread` to ingest an article URL, extract quote candidates, download article images, and build a thread draft.

## Draft Only

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/create-thread \
  -H 'Content-Type: application/json' \
  -d '{
    "article_url": "https://swarmsignal.net/robots-with-reasoning/",
    "account_slot": 1,
    "max_tweets": 6,
    "include_images": true,
    "schedule": false
  }'
```

## Create And Schedule

```bash
curl -sS -X POST http://127.0.0.1:3999/api/agent/create-thread \
  -H 'Content-Type: application/json' \
  -d '{
    "article_url": "https://swarmsignal.net/robots-with-reasoning/",
    "account_slot": 1,
    "scheduled_time": "2026-02-12T09:00:00Z",
    "schedule": true,
    "dedupe": true
  }'
```

## Response Notes

- `article.quote_candidates`: extracted quote hooks for editing/regeneration.
- `article.downloaded_media_urls`: images saved under `/uploads/...`.
- `draft.tweets`: ready payload for `/api/scheduler/thread`.
- `schedule_result`: returned when `schedule=true`.

## Workflow

1. Call `create-thread` with `schedule=false`.
2. Review and edit `draft.tweets`.
3. Schedule with:
   - `schedule=true` in the same endpoint, or
   - `POST /api/scheduler/thread` using edited tweets.
