#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT_FILE="$UNIT_DIR/x-manager.service"

mkdir -p "$UNIT_DIR"

cat >"$UNIT_FILE" <<EOF
[Unit]
Description=X Manager (Next.js dev server on 127.0.0.1:3999)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
ExecStartPre=/bin/test -d $ROOT_DIR
ExecStartPre=/bin/test -f $ROOT_DIR/package.json
ExecStartPre=/bin/test -x $ROOT_DIR/node_modules/.bin/next
ExecStartPre=/bin/mkdir -p $ROOT_DIR/logs
ExecStartPre=/bin/rm -rf $ROOT_DIR/.next
ExecStart=$ROOT_DIR/node_modules/.bin/next dev -H 127.0.0.1 -p 3999
Restart=always
RestartSec=5
# Use the same Node.js you run interactively (Linuxbrew on this machine), so native modules (better-sqlite3) load correctly.
Environment="PATH=/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/bin:/bin"
StandardOutput=journal
StandardError=journal
TimeoutStartSec=60

[Install]
WantedBy=default.target
EOF

cd "$ROOT_DIR"

# Stop the tmux-based dev server (if it's running) to avoid port conflicts.
npm run dev:stop >/dev/null 2>&1 || true
tmux kill-session -t x-manager-dev-3999 >/dev/null 2>&1 || true

echo "Installed unit file:"
echo "  $UNIT_FILE"
echo

if systemctl --user daemon-reload >/dev/null 2>&1; then
  systemctl --user enable x-manager.service
  systemctl --user restart x-manager.service
  systemctl --user status x-manager.service --no-pager || true
  echo
  echo "x-manager is now managed by systemd user units."
  echo "Logs: journalctl --user -u x-manager.service -n 200 --no-pager"
else
  echo "systemctl --user is not available in this session (no user bus)."
  echo "Run these manually in a normal terminal session:"
  echo "  systemctl --user daemon-reload"
  echo "  systemctl --user enable --now x-manager.service"
  echo "  systemctl --user status x-manager.service --no-pager"
fi
