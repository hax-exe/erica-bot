#!/usr/bin/env bash
# PostToolUse Edit|Write on src/**/*.ts: biome autofix + type-check; report errors via exit 2.
# tsc runs project-wide but only diagnostics located in the edited file fail the hook, so
# parallel agents' half-finished files do not block each other (verifier runs full tsc).
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
rel="${file#"$root"/}"
tsc=$(bun tsc --noEmit 2>&1)
if [ $? -ne 0 ]; then
  mine=$(grep -F -- "$rel(" <<<"$tsc")
  [ -n "$mine" ] && out+="tsc errors in $rel:"$'\n'"$mine"$'\n'
fi

if [ -n "$out" ]; then
  printf '%s\n' "$out" | head -n 30 >&2
  exit 2
fi
exit 0
