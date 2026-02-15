#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XM_URL="${XM_URL:-http://127.0.0.1:3999}"

systemd_user_available() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user show-environment >/dev/null 2>&1
}

systemd_unit_exists() {
  systemctl --user status x-manager.service >/dev/null 2>&1 && return 0
  systemctl --user list-unit-files x-manager.service >/dev/null 2>&1
}

usage() {
  cat <<'EOF'
Usage: ./xm <command> [args]

Core:
  start                  Start/ensure x-manager dev server (port 3999)
  status                 Show port/tmux status
  logs                   Tail dev server logs
  stop                   Stop dev server (best-effort)

Info:
  readiness              GET /api/system/readiness
  manifest               GET /api/system/agent
  list [slot]            GET /api/scheduler/posts (optional slot 1|2)

Schedule:
  schedule --at <iso> --text <text> [--slot 1|2] [--reply-to <tweetId>] [--community <id>]
           [--file <path>]... [--thread-id <id>] [--thread-index <n>] [--source-url <url>]

Media:
  upload <file>...       POST /api/scheduler/media (returns mediaUrls)

Threads:
  thread <json-file>     POST /api/scheduler/thread with JSON body from file
  create-thread --url <article-url> [--slot 1|2] [--max <n>] [--schedule --at <iso>] [--no-images] [--no-dedupe]
                        Build thread draft from article URL (optionally schedule immediately)

Env:
  XM_URL (default: http://127.0.0.1:3999)
EOF
}

cmd="${1:-}"
shift || true

case "$cmd" in
  start)
    if systemd_user_available && systemd_unit_exists; then
      systemctl --user start x-manager.service
      systemctl --user status x-manager.service --no-pager || true
    else
      cd "$ROOT_DIR"
      npm run dev:ensure
    fi
    ;;
  status)
    if systemd_user_available && systemd_unit_exists; then
      systemctl --user status x-manager.service --no-pager || true
    else
      cd "$ROOT_DIR"
      npm run dev:status
    fi
    ;;
  logs)
    if systemd_user_available && systemd_unit_exists; then
      journalctl --user -u x-manager.service -n 200 --no-pager || true
    else
      cd "$ROOT_DIR"
      npm run dev:logs
    fi
    ;;
  stop)
    if systemd_user_available && systemd_unit_exists; then
      systemctl --user stop x-manager.service || true
    fi
    cd "$ROOT_DIR"
    npm run dev:stop >/dev/null 2>&1 || true
    tmux kill-session -t x-manager-dev-3999 >/dev/null 2>&1 || true
    ;;
  readiness)
    curl -sS "$XM_URL/api/system/readiness"
    ;;
  manifest)
    curl -sS "$XM_URL/api/system/agent"
    ;;
  list)
    if [[ "${1:-}" =~ ^[12]$ ]]; then
      curl -sS "$XM_URL/api/scheduler/posts?account_slot=$1"
    else
      curl -sS "$XM_URL/api/scheduler/posts"
    fi
    ;;
  upload)
    if [[ $# -lt 1 ]]; then
      echo "upload: provide at least one file path" >&2
      exit 2
    fi
    args=( -sS -X POST "$XM_URL/api/scheduler/media" )
    for file in "$@"; do
      args+=( -F "files=@${file}" )
    done
    curl "${args[@]}"
    ;;
  thread)
    file="${1:-}"
    if [[ -z "$file" ]]; then
      echo "thread: provide a JSON file path" >&2
      exit 2
    fi
    curl -sS -X POST "$XM_URL/api/scheduler/thread" \
      -H 'Content-Type: application/json' \
      --data-binary "@${file}"
    ;;
  create-thread)
    article_url=""
    slot="1"
    at=""
    max_tweets="6"
    include_images="true"
    schedule="false"
    dedupe="true"

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --url) article_url="${2:-}"; shift 2 ;;
        --slot) slot="${2:-}"; shift 2 ;;
        --at) at="${2:-}"; shift 2 ;;
        --max) max_tweets="${2:-}"; shift 2 ;;
        --schedule) schedule="true"; shift ;;
        --no-images) include_images="false"; shift ;;
        --no-dedupe) dedupe="false"; shift ;;
        -h|--help) usage; exit 0 ;;
        *)
          echo "create-thread: unknown arg: $1" >&2
          exit 2
          ;;
      esac
    done

    if [[ -z "$article_url" ]]; then
      echo "create-thread: --url is required" >&2
      exit 2
    fi

    if [[ ! "$slot" =~ ^[12]$ ]]; then
      echo "create-thread: --slot must be 1 or 2" >&2
      exit 2
    fi

    if [[ "$schedule" == "true" && -z "$at" ]]; then
      echo "create-thread: --schedule requires --at <iso>" >&2
      exit 2
    fi

    esc_url="$(printf '%s' "$article_url" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
    payload="{\"article_url\":\"${esc_url}\",\"account_slot\":${slot},\"max_tweets\":${max_tweets},\"include_images\":${include_images},\"schedule\":${schedule},\"dedupe\":${dedupe}"
    if [[ -n "$at" ]]; then
      esc_at="$(printf '%s' "$at" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
      payload="${payload},\"scheduled_time\":\"${esc_at}\""
    fi
    payload="${payload}}"

    curl -sS -X POST "$XM_URL/api/agent/create-thread" \
      -H 'Content-Type: application/json' \
      --data-binary "$payload"
    ;;
  schedule)
    at=""
    text=""
    slot="1"
    reply_to=""
    community=""
    source_url=""
    thread_id=""
    thread_index=""
    files=()

    while [[ $# -gt 0 ]]; do
      case "$1" in
        --at) at="${2:-}"; shift 2 ;;
        --text) text="${2:-}"; shift 2 ;;
        --slot) slot="${2:-}"; shift 2 ;;
        --reply-to) reply_to="${2:-}"; shift 2 ;;
        --community) community="${2:-}"; shift 2 ;;
        --source-url) source_url="${2:-}"; shift 2 ;;
        --thread-id) thread_id="${2:-}"; shift 2 ;;
        --thread-index) thread_index="${2:-}"; shift 2 ;;
        --file) files+=( "${2:-}" ); shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *)
          echo "schedule: unknown arg: $1" >&2
          exit 2
          ;;
      esac
    done

    if [[ -z "$at" || -z "$text" ]]; then
      echo "schedule: --at and --text are required" >&2
      exit 2
    fi

    args=( -sS -X POST "$XM_URL/api/scheduler/posts" )
    args+=( -F "scheduled_time=${at}" )
    args+=( -F "text=${text}" )
    args+=( -F "account_slot=${slot}" )
    if [[ -n "$reply_to" ]]; then
      args+=( -F "reply_to_tweet_id=${reply_to}" )
    fi
    if [[ -n "$community" ]]; then
      args+=( -F "community_id=${community}" )
    fi
    if [[ -n "$source_url" ]]; then
      args+=( -F "source_url=${source_url}" )
    fi
    if [[ -n "$thread_id" ]]; then
      args+=( -F "thread_id=${thread_id}" )
    fi
    if [[ -n "$thread_index" ]]; then
      args+=( -F "thread_index=${thread_index}" )
    fi
    for file in "${files[@]}"; do
      args+=( -F "files=@${file}" )
    done
    curl "${args[@]}"
    ;;
  ""|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage
    exit 2
    ;;
esac
