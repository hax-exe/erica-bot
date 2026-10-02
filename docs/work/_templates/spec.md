# Spec: <title>

Intent: docs/work/<slug>/intent.md
Status: draft | approved

## Behavior
<User-visible behavior, commands/options, responses.>

## Design
<Modules, data flow, schema changes (bigint for ms/epoch), config.>

## Policy checklist
- [ ] CV2 only (no `content` with IsComponentsV2); ephemeral via flags
- [ ] Select menus: update() first; showModal() sole response; 10062/40060 swallowed
- [ ] Branding/addresses from src/lib/brand.ts
- [ ] Logging via sendLog / sendModLog / sendTicketLog / sendReportLog
- [ ] New migration only; existing migrations untouched

## Policy conflicts
<None, or list.>

## Acceptance criteria
- <testable criterion>

## Out of scope
- <item>
