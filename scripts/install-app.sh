#!/bin/sh
# Installs the latest build (release/mac-arm64/Local Notes.app) into /Applications,
# quitting the running copy first and relaunching it afterwards.
#
#   npm run desktop:install            # asks before quitting a running app
#   npm run desktop:install -- -y      # don't ask
#   npm run desktop:install -- --no-open
#
# INSTALL_DIR overrides the destination folder (default /Applications).
set -eu
cd "$(dirname "$0")/.."

app_name="Local Notes"
src="release/mac-arm64/$app_name.app"
dest_dir="${INSTALL_DIR:-/Applications}"
dest="$dest_dir/$app_name.app"
bin="$dest/Contents/MacOS/$app_name"

assume_yes=0
open_after=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=1 ;;
    --no-open) open_after=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

[ -d "$src" ] || die "no build found at $src. Run: npm run desktop:build"

# Don't install a half-written build.
lock=release/.build.lock
if [ -d "$lock" ]; then
  pid=$(cat "$lock/pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    die "a build is still running (see release/build.log); try again when it finishes"
  fi
fi

# PID of the installed app's main process, if running (exact executable path match).
running_pid() {
  ps -axo pid=,comm= | awk -v p="$bin" '{ pid = $1; sub(/^ *[0-9]+ /, ""); if ($0 == p) print pid }'
}

built=$(head -1 release/build.log 2>/dev/null | sed 's/^== //' || true)
echo "Installing: ${built:-$src}"
echo "        to: $dest"

pid=$(running_pid)
if [ -n "$pid" ]; then
  if [ "$assume_yes" -eq 0 ]; then
    [ -t 0 ] || die "$app_name is running; quit it first or pass -y"
    printf '%s is running. Make sure it shows "Saved", then press Enter to quit it (Ctrl+C to cancel) '  "$app_name"
    read -r _
  fi
  echo "Quitting $app_name..."
  osascript -e "tell application \"$app_name\" to quit" >/dev/null 2>&1 || true
  i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -le 30 ] || die "$app_name didn't quit within 15s; quit it manually and re-run"
    sleep 0.5
  done
fi

# Copy next to the destination first, then swap, so a failed copy leaves the old app intact.
staging="$dest_dir/.$app_name.app.installing"
rm -rf "$staging"
ditto "$src" "$staging"
rm -rf "$dest"
mv "$staging" "$dest"
echo "Installed."

if [ "$open_after" -eq 1 ]; then
  open "$dest"
  echo "Launched $app_name."
fi
