#!/usr/bin/env bash
# PostToolUse Edit|Write on src/**/*.ts: biome autofix + type-check; report errors via exit 2.
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$file" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$file" in
  "$root"/src/*.ts|"$root"/src/**/*.ts|src/*.ts|src/**/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$file" ] || exit 0
cd "$root" || exit 0

out=""
bio=$(bunx biome check --write "$file" 2>&1) || out+="biome check failed for $file:"$'\n'"$bio"$'\n'
tsc=$(bun tsc --noEmit 2>&1) || out+="bun tsc --noEmit failed:"$'\n'"$tsc"$'\n'

if [ -n "$out" ]; then
  printf '%s\n' "$out" | head -n 30 >&2
  exit 2
fi
exit 0
