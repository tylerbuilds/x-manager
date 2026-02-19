#!/usr/bin/env bash
# check-node-abi.sh — Prevents x-manager from starting with a mismatched
# better-sqlite3 native module.  If the ABI is stale it rebuilds automatically.
#
# Uses the same Node 22 LTS that the service is pinned to, regardless of what
# the caller's PATH says.  This is what stops the "brew upgraded node and now
# better-sqlite3 won't load" loop.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODULE="$PROJECT_DIR/node_modules/better-sqlite3/build/Release/better_sqlite3.node"

# Resolve the Node binary — always prefer the pinned Node 22 LTS.
NODE_22="/home/linuxbrew/.linuxbrew/opt/node@22/bin/node"
if [[ -x "$NODE_22" ]]; then
  NODE_BIN="$NODE_22"
  # Also ensure npm uses the same Node for rebuilds.
  export PATH="$(dirname "$NODE_22"):$PATH"
else
  NODE_BIN="node"
fi

if [ ! -f "$MODULE" ]; then
  echo "[check-node-abi] better_sqlite3.node not found — running npm rebuild" >&2
  cd "$PROJECT_DIR" && npm rebuild better-sqlite3
  exit 0
fi

# Quick smoke test: if Node can load the module, ABI is fine.
if "$NODE_BIN" -e "require('$MODULE')" 2>/dev/null; then
  exit 0
fi

echo "[check-node-abi] ABI mismatch detected ($("$NODE_BIN" --version)) — rebuilding better-sqlite3" >&2
cd "$PROJECT_DIR" && npm rebuild better-sqlite3

# Verify the rebuild actually fixed it.
if ! "$NODE_BIN" -e "require('$MODULE')" 2>/dev/null; then
  echo "[check-node-abi] FATAL: rebuild did not fix ABI mismatch" >&2
  exit 1
fi

echo "[check-node-abi] Rebuild successful" >&2
