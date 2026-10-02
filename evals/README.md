# Evals

Regression checks for the agent setup (CLAUDE.md, `.claude/agents/`, hooks). Each case is a task
prompt plus a deterministic acceptance check, derived from a real fix.

## Format

One JSON file per case in `evals/cases/`:

```json
{
  "id": "short-kebab-id",
  "source": "git commit or incident the case comes from",
  "prompt": "The task as you would give it to the orchestrator.",
  "acceptance": "Human-readable statement of what must be true afterwards.",
  "check": "shell command; exit 0 = pass (run from repo root)"
}
```

## Running

```bash
bun evals/run.ts          # validate all cases and run their checks
bun evals/run.ts <id>     # one case
```

The runner makes no LLM calls. It validates case shape and runs each `check`. Checks assert the
repo state a correct agent run must leave behind (on a fresh checkout they pass against the current
tree); to evaluate an agent, run the `prompt` on a branch with the fix reverted, then run the check.

## When to run

- Whenever CLAUDE.md, `.claude/agents/*` or `.claude/hooks/*` change.
- Every incident (agent got something wrong, bug shipped) becomes a new case: write the prompt, write
  a check that fails before the fix and passes after.
