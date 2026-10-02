#!/usr/bin/env bash
# PostToolUse Edit|Write on src/**: warn (never block) when an active docs/work/<slug>/plan.md
# (a "Status: done" line is absent; _templates skipped) has no uncommitted change (not modified,
# not untracked-new) while src/** has uncommitted changes, i.e. the plan may be stale.
# Warning goes to the model as PostToolUse additionalContext JSON on stdout. Always exits 0.
input=$(cat)
file=$(jq -r '.tool_input.file_path // empty' <<<"$input")
[ -z "$file" ] && exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$file" in
  "$root"/src/*|src/*) ;;
  *) exit 0 ;;
esac
cd "$root" 2>/dev/null || exit 0
[ -n "$(git status --porcelain -- src 2>/dev/null)" ] || exit 0
stale=()
for plan in docs/work/*/plan.md; do
  [ -f "$plan" ] || continue
  case "$plan" in docs/work/_*) continue ;; esac
  grep -Eiq '^[[:space:]]*(\*\*)?status(\*\*)?[[:space:]]*:[[:space:]]*(\*\*)?done([^[:alnum:]|]|$)' "$plan" && continue
  [ -z "$(git status --porcelain -- "$plan" 2>/dev/null)" ] && stale+=("$plan")
done
[ "${#stale[@]}" -eq 0 ] && exit 0
msg="plan-sync: ${file#"$root"/} changed but active plan(s) ${stale[*]} have no uncommitted update. Update plan.md if you departed from it."
jq -n --arg m "$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
exit 0
