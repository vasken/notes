#!/bin/sh
# Builds the desktop app (release/mac-arm64/Local Notes.app + .dmg).
# Run by the post-commit hook in the background; safe to run by hand too.
# Commits made while a build is running are coalesced into one follow-up build.
set -u
cd "$(dirname "$0")/.." || exit 1
mkdir -p release
log=release/build.log
lock=release/.build.lock
pending=release/.build.pending

# Text is passed as argv, never spliced into the AppleScript source, so quotes
# in a commit message can't break (or inject into) the script.
notify() {
  osascript \
    -e 'on run argv' \
    -e 'display notification (item 2 of argv) with title "Local Notes" subtitle (item 1 of argv)' \
    -e 'end run' \
    -- "$1" "$2" >/dev/null 2>&1 || true
}

touch "$pending"

# Take the lock; clear it if the process that held it is gone.
if ! mkdir "$lock" 2>/dev/null; then
  pid=$(cat "$lock/pid" 2>/dev/null)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    exit 0  # build in progress; it will pick up the pending request
  fi
  rm -rf "$lock"
  mkdir "$lock" || exit 0
fi
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT

while [ -e "$pending" ]; do
  rm -f "$pending"
  commit=$(git log -1 --format='%h %s')
  start=$(date +%s)
  {
    echo "== $(date '+%Y-%m-%d %H:%M:%S') building $commit"
    git diff --quiet HEAD 2>/dev/null || echo "!! working tree has uncommitted changes; they are included in this build"
  } > "$log"
  if npm run desktop:dmg >> "$log" 2>&1; then
    secs=$(( $(date +%s) - start ))
    echo "== done in ${secs}s" >> "$log"
    notify "Build ready (${secs}s)" "$commit"
  else
    echo "== FAILED" >> "$log"
    notify "Build failed: see release/build.log" "$commit"
  fi
done
