#!/usr/bin/env bash
# PreToolUse Edit|Write: block edits to .env and existing drizzle migrations/snapshots.
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$file" ] && exit 0
base=$(basename "$file")
block() { echo "Blocked: $1 ($file). $2" >&2; exit 2; }

if [ "$base" = ".env" ]; then
  block "never edit .env" "Edit .env.example or ask the user."
fi

# Only existing files are protected; new files (db:generate output) may be created.
[ -e "$file" ] || exit 0

case "$file" in
  */drizzle/meta/*_snapshot.json)
    block "existing drizzle snapshot is immutable" "Never modify migrations; generate a new one with bun run db:generate." ;;
  */drizzle/[0-9][0-9][0-9][0-9]_*.sql)
    block "existing drizzle migration is immutable" "Never modify, rename or renumber; generate a new one with bun run db:generate." ;;
esac
exit 0
