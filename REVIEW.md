# Review guidelines

Applies to `discord-interaction-reviewer`, `migration-reviewer`, `spec-compliance-reviewer` and human review. Reviewers are never the author of the change.

## Passes (in order)

1. **Bugs**: logic errors, unhandled rejections, wrong control flow, race conditions, broken interaction responses (e.g. double reply, `content` with CV2).
2. **Security**: missing preconditions (`BotAdmin`, `Moderation`, `TicketStaff`), permission bypasses, unsanitized input, leaked secrets/tokens, hard-coded origins, unsafe JSON parsing.
3. **Conformance**: matches CLAUDE.md conventions and `docs/work/<slug>/spec.md` + `plan.md` (requirements met, no scope creep, deviations recorded in plan.md).

## Severity

- **Important**: must fix before merge. Bugs, security issues, convention violations that change behavior, spec/plan mismatches, migration immutability or missing journal/snapshot.
- **Nit**: minor, optional (naming, small clarity). Report at most about 5; drop the rest.

## Output

One line per finding: `[Important|Nit] path:LINE - problem - fix`. If nothing: exactly `No violations found.`

## Excluded paths

These exclusions apply to the general passes; `migration-reviewer` is the exception and does check immutability, journal and snapshot in `drizzle/*.sql` and `drizzle/meta/**`. Do not review: `drizzle/meta/**`, `drizzle/*.sql` (generated; only check they are added, not edited, and accompany the schema change), lockfiles, `data/**`.
