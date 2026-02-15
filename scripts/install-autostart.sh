#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AUTOSTART_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/autostart"
DESKTOP_FILE="$AUTOSTART_DIR/x-manager.desktop"
START_SCRIPT="$ROOT_DIR/scripts/autostart-x-manager.sh"

mkdir -p "$AUTOSTART_DIR"

cat >"$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=X Manager
Comment=Start x-manager (port 3999) in the background
Exec=$START_SCRIPT
Terminal=false
X-GNOME-Autostart-enabled=true
EOF

chmod +x "$START_SCRIPT"

echo "Installed autostart entry:"
echo "  $DESKTOP_FILE"
echo
echo "It will run on next graphical login."
echo "To test immediately: $START_SCRIPT"

