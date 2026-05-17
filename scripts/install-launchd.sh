#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NPX_BIN="$(command -v npx)"
if [ -z "$NPX_BIN" ]; then
  echo "npx not found in PATH" >&2
  exit 1
fi
PATH_ENV="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$(dirname "$NPX_BIN")"

PLIST_DEST="$HOME/Library/LaunchAgents/com.user.daily-pulse.plist"
mkdir -p "$HOME/Library/LaunchAgents"

sed \
  -e "s|__REPO__|$REPO|g" \
  -e "s|__NPX_BIN__|$NPX_BIN|g" \
  -e "s|__PATH__|$PATH_ENV|g" \
  "$REPO/scripts/com.user.daily-pulse.plist.template" > "$PLIST_DEST"

launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "[install-launchd] loaded $PLIST_DEST"
echo "[install-launchd] next run: tomorrow 07:00 local"
echo "[install-launchd] to test now: launchctl start com.user.daily-pulse"
