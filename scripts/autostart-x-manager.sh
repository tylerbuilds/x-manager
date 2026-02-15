#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

# Keep the dev server alive (prefers tmux when available).
mkdir -p "$ROOT_DIR/logs"
npm run dev:ensure >>"$ROOT_DIR/logs/autostart.log" 2>&1 || true
