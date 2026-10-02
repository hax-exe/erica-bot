#!/usr/bin/env bash
# PreToolUse Bash: block npm/yarn/pnpm/npx used as a command word.
input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
[ -z "$cmd" ] && exit 0
if grep -Eq '(^|[;&|(`]|\$\(|&&|\|\||[[:space:]](sudo|exec|time|env|xargs)[[:space:]])[[:space:]]*(npm|yarn|pnpm|npx)([[:space:]]|$)' <<<"$cmd"; then
  echo "Use bun / bunx (npm, yarn, pnpm and npx are not allowed in this project)." >&2
  exit 2
fi
exit 0
