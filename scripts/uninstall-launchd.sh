#!/usr/bin/env bash
set -euo pipefail
PLIST="$HOME/Library/LaunchAgents/com.user.daily-pulse.plist"
launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "[uninstall-launchd] removed $PLIST"
