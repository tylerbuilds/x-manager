#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORT="${PORT:-3999}"
HOST="${HOST:-127.0.0.1}"

LOG_DIR="${LOG_DIR:-$ROOT_DIR/logs}"
PID_FILE="${PID_FILE:-$LOG_DIR/x-manager-dev-${PORT}.pid}"
LOG_FILE="${LOG_FILE:-$LOG_DIR/x-manager-dev-${PORT}.log}"
SESSION_NAME="${SESSION_NAME:-x-manager-dev-${PORT}}"
NEXT_BIN="${NEXT_BIN:-$ROOT_DIR/node_modules/next/dist/bin/next}"
NODE_BIN="${NODE_BIN:-}"

default_node_bin() {
  if [[ -n "$NODE_BIN" ]]; then
    echo "$NODE_BIN"
    return 0
  fi

  # Pin Node 22 LTS — better-sqlite3 native module is compiled against it.
  # Falling through to an unversioned 'node' causes ABI mismatches when brew upgrades.
  if [[ -x "/home/linuxbrew/.linuxbrew/opt/node@22/bin/node" ]]; then
    echo "/home/linuxbrew/.linuxbrew/opt/node@22/bin/node"
    return 0
  fi

  if [[ -x "/usr/local/bin/node" ]]; then
    echo "/usr/local/bin/node"
    return 0
  fi

  echo "node"
}

default_db_path() {
  if [[ -n "${X_MANAGER_DB_PATH:-}" ]]; then
    echo "$X_MANAGER_DB_PATH"
    return 0
  fi
  echo "$ROOT_DIR/var/x-manager.sqlite.db"
}

is_listening() {
  # lsof can hang on some network-mounted volumes; use a simple TCP probe instead.
  command -v nc >/dev/null 2>&1 || return 1
  nc -z -w 1 "$HOST" "$PORT" >/dev/null 2>&1
}

pid_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

tmux_available() {
  command -v tmux >/dev/null 2>&1 || return 1
  tmux -V >/dev/null 2>&1 || return 1
}

tmux_session_exists() {
  tmux has-session -t "$SESSION_NAME" >/dev/null 2>&1
}

start() {
  mkdir -p "$LOG_DIR"
  mkdir -p "$ROOT_DIR/var"
  mkdir -p "$ROOT_DIR/.next-local" 2>/dev/null || true

  local node_bin
  node_bin="$(default_node_bin)"
  local db_path
  db_path="$(default_db_path)"

  if is_listening; then
    echo "already listening on ${HOST}:${PORT}"
    return 0
  fi

  if [[ ! -f "$NEXT_BIN" ]]; then
    echo "missing $NEXT_BIN (run: npm install)"
    return 1
  fi

  # Validate native module ABI before starting — dev-3999.sh invokes node
  # directly (bypassing npm lifecycle hooks), so this is the only check.
  if [[ -x "$ROOT_DIR/scripts/check-node-abi.sh" ]]; then
    PATH="$(dirname "$node_bin"):$PATH" "$ROOT_DIR/scripts/check-node-abi.sh" || {
      echo "ABI check failed — cannot start"
      return 1
    }
  fi

  # Prefer tmux when available (more reliable than backgrounding in some environments).
  if tmux_available; then
    # PID file is only for the non-tmux fallback.
    rm -f "$PID_FILE" 2>/dev/null || true

    if tmux_session_exists; then
      # If a tmux session exists but the port isn't up, restart the session.
      tmux kill-session -t "$SESSION_NAME" >/dev/null 2>&1 || true
    fi

    tmux new-session -d -s "$SESSION_NAME" \
      "cd \"$ROOT_DIR\" && X_MANAGER_DB_PATH=\"$db_path\" NEXT_TELEMETRY_DISABLED=1 exec \"$node_bin\" \"$NEXT_BIN\" dev -H \"$HOST\" -p \"$PORT\" >>\"$LOG_FILE\" 2>&1"

    # Wait up to ~60s for the port to come up.
    for _ in {1..120}; do
      if is_listening; then
        echo "started (tmux $SESSION_NAME) listening on ${HOST}:${PORT}"
        return 0
      fi
      sleep 0.5
    done

    echo "failed to start via tmux; see $LOG_FILE"
    return 1
  fi

  # Clean up stale pid file if needed.
  if [[ -f "$PID_FILE" ]] && ! pid_running; then
    rm -f "$PID_FILE"
  fi

  # Detach so the dev server survives terminal/session disconnects.
  # Use 'exec' so the PID we record is the actual Next.js dev server process.
  nohup bash -lc "cd \"$ROOT_DIR\" && X_MANAGER_DB_PATH=\"$db_path\" NEXT_TELEMETRY_DISABLED=1 exec \"$node_bin\" \"$NEXT_BIN\" dev -H \"$HOST\" -p \"$PORT\"" \
    >>"$LOG_FILE" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"

  # Wait up to ~60s for the port to come up.
  for _ in {1..120}; do
    if is_listening; then
      echo "started (pid $(cat "$PID_FILE")) listening on ${HOST}:${PORT}"
      return 0
    fi
    sleep 0.5
  done

  echo "failed to start; see $LOG_FILE"
  return 1
}

stop() {
  if tmux_available && tmux_session_exists; then
    echo "stopping tmux session $SESSION_NAME"
    tmux kill-session -t "$SESSION_NAME" >/dev/null 2>&1 || true
    rm -f "$PID_FILE" 2>/dev/null || true
    echo "stopped"
    return 0
  fi

  if pid_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "stopping pid $pid"
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$PID_FILE"
        echo "stopped"
        return 0
      fi
      sleep 0.5
    done
    echo "force killing pid $pid"
    kill -KILL "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    return 0
  fi

  rm -f "$PID_FILE" 2>/dev/null || true
  echo "not running"
  return 0
}

status() {
  if is_listening; then
    echo "listening on ${HOST}:${PORT}"
  else
    echo "not listening on :$PORT"
  fi

  if tmux_available && tmux_session_exists; then
    echo "tmux: $SESSION_NAME (running)"
    rm -f "$PID_FILE" 2>/dev/null || true
    echo "pid file: (not used in tmux mode)"
  else
    echo "tmux: (none)"
    if pid_running; then
      echo "pid file: $(cat "$PID_FILE") (running)"
    else
      if [[ -f "$PID_FILE" ]]; then
        echo "pid file: $(cat "$PID_FILE" 2>/dev/null || echo '?') (stale)"
      else
        echo "pid file: (none)"
      fi
    fi
  fi

  echo "log: $LOG_FILE"
}

logs() {
  mkdir -p "$LOG_DIR"
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 200 "$LOG_FILE"
  else
    echo "no log file yet: $LOG_FILE"
  fi
}

usage() {
  cat <<EOF
Usage: $(basename "$0") {start|stop|restart|status|logs|ensure}

Env vars:
  PORT (default: 3999)
  HOST (default: 127.0.0.1)
  SESSION_NAME (default: x-manager-dev-\$PORT)
  NODE_BIN (optional: override the Node.js executable used)
  X_MANAGER_DB_PATH (optional: override SQLite DB path)
EOF
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop || true; start ;;
  status) status ;;
  logs) logs ;;
  ensure) if is_listening; then status; else start; fi ;;
  *) usage; exit 2 ;;
esac
