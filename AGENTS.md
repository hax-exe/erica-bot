# AGENTS.md

Guidance for AI coding agents working in the **erica-bot** repository.

## Stack overview

Discord bot built with **discord.js 14**, **TypeScript** (strict mode), **ESM modules**.
Runtime: **Node.js >= 20**. Database: **PostgreSQL** via **Drizzle ORM**. Cache: **Redis** (ioredis).
Music: **Kazagumo / Shoukaku** (Lavalink). API: **Express 5**. Logging: **pino**.
Testing: **Vitest**. Linting: **ESLint** (flat config, typescript-eslint). Config validation: **Zod**.

## Build / lint / test commands

```bash
npm ci                  # install (use ci, not install, for deterministic lockfile)
npm run build           # tsc + copy assets to dist/
npm run start           # run compiled output (dist/index.js)
npm run dev             # tsx watch mode (hot-reload)
npm run dev:once        # tsx single run (no watch)
npm run lint            # eslint src/
npm run lint:fix        # eslint src/ --fix
npx tsc --noEmit        # typecheck without emitting
```

### Testing

```bash
npm test                # vitest in watch mode
npm run test:run        # vitest run (single pass, used in CI)
npm run test:coverage   # vitest run --coverage
```

**Run a single test file:**
```bash
npx vitest run tests/services/automod.test.ts
```

**Run a single test by name:**
```bash
npx vitest run -t "should detect banned word"
```

Test files live in `tests/` (mirroring `src/` structure) and use the `.test.ts` suffix.
Vitest config: `vitest.config.ts` -- globals enabled, node environment, 10 s timeout.

### Database

```bash
npm run db:generate     # generate Drizzle migration files
npm run db:migrate      # apply migrations
npm run db:push         # push schema directly (dev shortcut)
npm run db:studio       # open Drizzle Studio GUI
```

Schema source: `src/db/schema/index.ts`. Migrations output: `drizzle/`.

### CI pipeline (.github/workflows/ci.yml)

CI runs: `npm ci` -> `npm audit --audit-level=high` -> `npm run lint` -> `npx tsc --noEmit` -> `npm run test:run`.
Replicate locally before pushing.

## Code style

### TypeScript and module system

- Target **ES2022**, module **NodeNext**, strict mode with `noImplicitAny`, `strictNullChecks`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noImplicitReturns` enabled.
- **ESM only** (`"type": "module"` in package.json). All internal imports must use
  explicit `.js` extensions even though source files are `.ts`:
  ```ts
  import { createLogger } from '../utils/logger.js';
  ```
- Use `import type` for type-only imports:
  ```ts
  import type { Command } from '../types/Command.js';
  ```
- Prefer **relative imports**. Path aliases (`@/*`, `@commands/*`, etc.) are configured in
  `tsconfig.json` but are not used in the codebase -- do not introduce them.

### Import ordering

Group imports in this order, separated by a blank line when it aids readability:
1. Third-party packages (`discord.js`, `express`, `drizzle-orm`, `zod`, etc.)
2. Internal project imports (relative paths)
3. Type-only imports (may be inlined with value imports when co-located)

### Formatting

- **4-space indentation**, semicolons required, single quotes for strings.
- Trailing commas in multiline objects/arrays/parameter lists.
- No Prettier config exists; follow existing file conventions.

### Naming conventions

| Kind | Convention | Examples |
|---|---|---|
| Classes, interfaces, types | PascalCase | `ExtendedClient`, `CommandOptions` |
| Functions, variables | camelCase | `createLogger`, `atomicBalanceUpdate` |
| Files | lowercase, feature-based | `play.ts`, `stateManager.ts`, `voiceChannel.ts` |
| Unused parameters | prefix with `_` | `_req`, `_next` |

### Exported function signatures

Add explicit return types on exported functions:
```ts
export function startApiServer(client: ExtendedClient): void { ... }
export async function atomicTransfer(...): Promise<TransferResult> { ... }
```

### Error handling

- **Early returns** for validation before main logic.
- Wrap external I/O (database, Discord API, Redis) in `try/catch`.
- Log the error with context, then return a safe response to the caller.
- Empty `catch` blocks are acceptable only for intentional cleanup/fallback paths.

### Logging

Create a module-scoped logger and use structured pino-style logging:
```ts
const logger = createLogger('module-name');
logger.info('Bot started');
logger.error({ error, guildId }, 'Failed to fetch member');
```
**Do not** add new `console.log` / `console.error` calls. Use `createLogger` from
`src/utils/logger.ts`.

### Command and event patterns

- Slash commands: `export default new Command({ ... })` in `src/commands/<category>/<name>.ts`.
- Events: `export default new Event({ ... })` in `src/events/<eventName>.ts`.
- These are loaded dynamically at startup via the structures in `src/structures/`.

### Environment and config

- All env vars are validated with Zod in `src/config/index.ts`.
- Access config via the exported `config` object, not `process.env` directly.
- Required env vars for tests: see `.env.example` and CI workflow.
- **Never** commit `.env` or secrets.

## Testing conventions

- Import test utilities explicitly even though globals are enabled:
  ```ts
  import { describe, it, expect, vi } from 'vitest';
  ```
- Use nested `describe` / `it` blocks with descriptive names.
- For modules with side effects or heavy dependencies, use `vi.mock()` at the top
  of the file, then dynamically `import()` the module under test inside each test:
  ```ts
  vi.mock('../../src/db/index.js', () => ({ pool: { connect: vi.fn() } }));
  // inside test:
  const { atomicBalanceUpdate } = await import('../../src/db/transactions.js');
  ```
- Prefer isolated unit tests. Integration tests that need Postgres use the CI
  service container (see `.github/workflows/ci.yml`).

## ESLint rules of note

- `@typescript-eslint/no-explicit-any`: **off** (complex Discord.js types).
- `@typescript-eslint/no-unused-vars`: **warn**, with `_` prefix ignored.
- `eqeqeq`: **warn** -- use `===` / `!==`.
- `no-console`: **off** (but prefer `createLogger` for new code).
- ESLint only applies to `src/**/*.ts`; config files and tests are excluded.

## Agent workflow checklist

1. Read relevant source files before editing.
2. After changes, run `npx tsc --noEmit` and `npm run lint` to verify.
3. Run related tests: `npx vitest run tests/<path>.test.ts`.
4. If adding a new feature, add or update tests in `tests/`.
5. Do not modify `.env`, `package-lock.json`, or migration files unless explicitly asked.
6. Keep commits focused; match existing commit message style from `git log`.
