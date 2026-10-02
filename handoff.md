# Handoff — Erica maintenance pass

Draft PR: **[hax-exe/erica-bot#94](https://github.com/hax-exe/erica-bot/pull/94)**. Branch: `claude/tender-einstein-oxklpt`, based on `main` @ `8a0a9ae`.

The goal was to fix everything that could throw at runtime and make all naming use the bot brand **"Erica"**.

---

## 1. Status at handoff

- **Working tree is clean.** All work is committed and pushed. The branch head is `376a86f`, equal to `origin/claude/tender-einstein-oxklpt`.
- **No half-finished code changes exist.** Section 4 lists what is still open: things waiting on CI or the user, plus follow-ups that were deliberately left out.
- **CI** (`build-and-push`, a Docker image build on PRs to `main`):
  - Passed on `2235b80`.
  - Was still **in progress** on `376a86f` at handoff. The commits after `2235b80` are small code fixes that type-check and lint cleanly.
- **Verification is clean on the final head:**
  - `bunx tsc --noEmit` passes, with 0 errors.
  - `bun run lint` shows 0 errors and 67 warnings, down from 75 on `main`.
  - The piece-loading harness (Appendix A) passes.
  - Migrations were tested on a real MySQL 8.4.

## 2. Decisions the user made

| Question | Answer |
|---|---|
| Brand name | **"Erica"** only: no "AloraMC", no "Origin Earth", no "Erica Bot" or "Erica-Bot". |
| Domain (`aloramc.com` / `.net`) | **Remove every reference.** The domain is being cancelled, so don't add a replacement. Server address and CORS origins now come from env vars. |
| Way of working | Use multiple agents. Five implementers worked in parallel on disjoint file sets, then three independent reviewers checked their work. |

**Decision on `bedrock.originearth.live`:** the user chose to remove it. The `proxy` service (game category) and the `database1` service plus the now-empty `databases` category were removed from `config/status.yml` in the commit that updated this file. No `originearth` references remain.

## 3. What was done

These are the commits on `main..HEAD`, oldest first.

| Commit | Content |
|---|---|
| `40a3b4f` | **Shared helpers.** `src/lib/brand.ts`: `BOT_NAME`, `BOT_VERSION`, `USER_AGENT`, `WEBHOOK_NAMES`, `getMinecraftServerAddress()` (env `MINECRAFT_SERVER_IP`), `getAllowedOrigins()` (env `API_ALLOWED_ORIGINS`). `src/lib/safe.ts`: `safeJsonParse`, `isDuplicateKeyError`, and `isPublicHttpUrl` (added in `5e9f2cb`). |
| `d193634` | **Database.** Committed `drizzle/meta/`, which was git-ignored, so `migrate()` crashed on every fresh deploy. The 0000 journal `when` is pinned to `1700000000000` so databases that already applied it skip it. Changed `int` columns to `bigint` for `xp.last_message_at` (its `Date.now()` write broke every XP award) and for millisecond durations, which overflowed past about 24.8 days. Widened two `varchar` columns. Migration `0001`. `index.ts`: fail fast without `DISCORD_TOKEN`, add the `GuildScheduledEvents` intent, and add the privileged `GuildPresences` intent only when `DISCORD_PRESENCE_INTENT=true`. |
| `41a129f` | **Docs and infra.** Erica-only docs. `.env.example` rewritten for MySQL with every variable the code reads. The compose image is now `ghcr.io/hax-exe/erica-bot`. The Dockerfile copies `bunfig.toml`. `.env.*` is git-ignored. Removed scripts with broken imports. |
| `595f4d6` | **Moderation.** See the summary below the table. |
| `706c8cf` | **Core libraries.** `sendToWebhook` returns a boolean; before, every report said "not configured". Hardened `GuildConfigApi` and `ApiServer`: CORS comes from env, Floodgate UUIDs are accepted via `z.guid`. Race-safe `getOrCreate*`. Fetch timeouts everywhere. `TicketManager` handles deleted channels. The module cache is 30s, cleared by `invalidateModuleCache()`. **AutoMod module semantics** and migration `0002`: see 4.2. |
| `4edf124` | **Music, fun and general.** `/music filter`, `/music loop` set to "off" and `/volume` with no level no longer throw. `has(a\|b)` changed to `any()`. `/status` is bot-owner only. `/quote` access check. `/minecraft` with no default domain. The ReDoS regex is gone. Economy coin-safety fixes (duel used to mint coins). Wordle and trivia limits. Game timers. Birthday date maths. Mentions blocked in echo commands. |
| `2235b80` | **Config, tickets and listeners.** See the summary below the table. |
| `5e9f2cb` | **Review fixes.** Rank-card SSRF (`isPublicHttpUrl`, no redirects). Rerolls no longer shrink the winner list. `/suggest` and story topics can't ping. `/quote` checks private-thread membership. |
| `873031d` | **Review fixes.** The tempban scheduler claims each row with DELETE before unbanning. Announcing to @everyone or a non-mentionable role needs Mention Everyone. The Delete Case button permission matches `/case delete`. Timerole revoke uses the role policy. Edit Reason pre-fill respects the 500-character limit. Combine no longer self-links. |
| `57eddb7` | **Review fixes.** The timed-role scheduler retries permission errors instead of leaving the role on the member forever. Recurring reminders are only dropped when undeliverable. `/automod toggle` enables the guild module even while AutoMod is off globally. Webhook limit 30007 handling. |
| `376a86f` | The `config/status*.yml` comments now say `/status reload`. |

**`595f4d6` (moderation) in more detail:**
- `/case combine` was unreachable and is routed again.
- `/mod mass` and `/warn` no longer fail with error 50035.
- Members are fetched rather than read from cache, so hierarchy checks run.
- Permission gaps closed: config subcommands need Manage Server; role and timerole changes need Manage Roles plus the role hierarchy.
- Manual unbans and new bans clear stale tempban rows.
- Button modal labels are now 45 characters or fewer; the old labels threw, so those buttons were dead.
- Audit-log mod logs no longer crash on a fake user object.
- The anti-raid timers are fixed.

**`2235b80` (config, tickets, listeners) in more detail:**
- Leveling, autoresponder and sticky `messageCreate` listeners had the same Sapphire piece name, so only one of them loaded. They have unique names now.
- Removed the duplicate, unconditional AutoMod listener.
- New `errors/chatInputSubcommandError.ts`. Before it, subcommand errors left users on "thinking…".
- CV2 flag fixes.
- The webhook is created before the old one is deleted.
- Reviews defer first. Starboard duplicate check fixed. Scheduler give-up rules.
- Boost listeners handle a partial `oldMember`, using a "premiumSince is recent" check.
- Pagination truncates long reasons.

**How it was verified:**
- tsc and biome on every commit. Each partial commit was checked by exporting the staged index to a scratch directory and type-checking it there.
- The harness (Appendix A). On `main` it reports 4 real problems. On HEAD it reports 0: 59 chat-input commands, 9 context-menu commands, 114 listener pieces.
- MySQL 8.4 migration scenarios (section 5).
- Three adversarial review agents went over the whole diff, and all their findings are fixed.
- **Never tested against live Discord.** No bot token was available.

## 4. Open items: finish these first

1. **CI.** CI was green on `a68c402`. Confirm `build-and-push` is green on whatever HEAD is by then. If it's red, open the job log (it's a Docker build) and fix it.
2. **User decisions on process:** the user wants the PR watched for CI and review comments, and wants this file (`handoff.md`) KEPT as a reference for future changes.
3. **This file (`handoff.md`)** stays in the repo on purpose. Do not delete it before merge.
4. **Mark the PR ready for review** once CI is green and the user has reviewed it. It is a draft now.
5. **Deployment notes**, already in the PR description. Repeat them to the user if they ask:
   - **Local `drizzle/meta/`:** delete any local copy before pulling. It was untracked, so git will refuse to overwrite it.
   - **New env vars:**
     - `MINECRAFT_SERVER_IP`: verification text and the `/minecraft status` default.
     - `API_ALLOWED_ORIGINS`: CORS. Empty means no browser origin is allowed.
     - `DISCORD_PRESENCE_INTENT`: opt-in.
   - **Migration `0002`** sets `global_modules.automod = 1`, and sets `guild_modules.automod = 1` for every guild with an enabled AutoMod rule. This keeps AutoMod running where it effectively ran before (see 4.2). If the owner really wants AutoMod off globally, they toggle it off again with `/admin modules` after deploying.

### 4.2 Why AutoMod needed a data migration

Before this work, `src/listeners/messageCreate.ts` ran `runAutomod` on every message regardless of module toggles. That file is now deleted, and AutoMod is gated by `isModuleEnabled(…, 'automod')`. Two old defaults would then have switched AutoMod off silently:

- **Global row:** `global_modules.automod` defaulted to `false`. Creating the global row for any reason, such as toggling music globally, killed AutoMod everywhere.
- **Guild rows:** `isModuleEnabled` returned `true` for a guild with no row, but creating the row (for example by viewing `/module list`) stored `automod = false`.

The fix has four parts:
- The global default is now `true`.
- A guild without a row falls back to the `guild_modules` column defaults. That logic is `GUILD_MODULE_DEFAULTS` in `src/lib/ModuleUtil.ts`.
- `drizzle/0002_large_hemingway.sql` re-enables AutoMod where it was effectively active.
- Enabling a rule, through `/automod toggle` or the API's automod PATCH, turns the module on.

## 5. How to verify

**Basic checks:**
```bash
bun install --ignore-scripts     # node_modules is not in the repo
bunx tsc --noEmit                # expect no output
bun run lint                     # expect 0 errors
```

**MySQL for testing.** The Docker daemon isn't running by default in this sandbox, and Docker Hub rate-limits pulls, so use the GCR mirror:
```bash
nohup dockerd > /tmp/dockerd.log 2>&1 &
docker pull mirror.gcr.io/library/mysql:8.4
docker run -d --name erica-mysql-test -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=erica -p 3307:3306 mirror.gcr.io/library/mysql:8.4
# wait for "ready for connections ... port: 3306" in `docker logs erica-mysql-test`
```

**Migration test.** Importing `src/lib/database.ts` also runs migrations.
- Fresh DB: `DATABASE_URL=mysql://root:root@127.0.0.1:3307/<db> bun src/migrate.ts`. Expect 3 rows in `__drizzle_migrations`.
- Already-migrated DB:
  1. Load `drizzle/0000_*.sql` by hand, with `--> statement-breakpoint` stripped.
  2. Create `__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`.
  3. Insert the sha256 of the 0000 file with `created_at = 1788650000000`.
  4. Run the migrator. Only 0001 and 0002 should apply.

**Harness.** Copy Appendix A to `node_modules/.harness/harness.ts`, so it is git-ignored and imports resolve, then run:
```bash
DATABASE_URL=mysql://root:root@127.0.0.1:3307/<fresh_db> bun node_modules/.harness/harness.ts
```
Expect: `OK — all commands registered cleanly, no piece collisions.`

## 6. Follow-ups deliberately not done, roughly by priority

1. **SSRF through DNS for rank-card images.**
   - **Where:** `src/lib/RankCardUtil.ts` `safeLoadImage` and `isPublicHttpUrl` in `src/lib/safe.ts`.
   - **Problem:** a public hostname that resolves to a private IP is still fetched.
   - **Fix:** resolve the host with `dns.lookup`, reject private and loopback ranges, and connect to the pinned IP.
2. **SSRF in user-supplied RSS URLs.**
   - **Where:** `resolveRssFeed` in `src/lib/FeedPoller.ts` (about line 395) and the poller.
   - **Fix:** apply `isPublicHttpUrl` plus the DNS check.
3. **API rate limiter trusts spoofable headers.**
   - **Where:** `src/lib/ApiServer.ts` (about lines 112-115) reads `CF-Connecting-IP` and `X-Forwarded-For`.
   - **Fix:** only trust them behind a configured proxy, for example a `TRUST_PROXY=true` env var.
4. **Timers lost on restart.**
   - **Where:**
     - Slowmode and lock auto-reset: `src/commands/moderation/mod.ts`, `setTimeout` at about lines 898 and 1093.
     - Birthday-role removal: `src/listeners/birthdays/scheduler.ts` (about line 83).
     - Anti-raid lock state: in memory in `src/listeners/moderation/antiRaid.ts`.
     - Voice XP sessions: `voiceJoinTimestamps` in `src/listeners/leveling/voiceStateUpdate.ts`.
   - **Fix:** persist expiries in the database and resume them on ready.
5. **Giveaway rerolls only exclude the current winners**, so A wins, B wins, then A can win again.
   - **Where:** `src/commands/general/giveaway.ts` (about line 416).
   - **Fix:** a cumulative `past_winner_ids` column plus a migration.
6. **Module toggles aren't enforced by every command.** These commands don't call `isModuleEnabled`: music, tags, reports, reviews, welcomer, starboard and sticky. Also, `/module list` ignores the global kill switch.
7. **Permission-policy questions for the user:**
   - `/case delete` and `/case combine` only need the `Moderation` precondition.
   - The `Moderation` precondition also accepts Moderate Members and Administrator, which differs from AGENTS.md.
8. **Smaller items:**
   - **Online counter:** `src/lib/StatsChannelUtil.ts` "Online" always reads 0 unless `DISCORD_PRESENCE_INTENT=true`. Hide it otherwise.
   - **Dead build script:** `package.json` `build` and `main` produce a bundle that can't load Sapphire pieces from disk. Remove them or document them as unused.
   - **Husky:** the `prepare` script runs husky, but the repo has no `.husky/` directory.
   - **`SECURITY.md`:** lines 21-22 claim Dependabot and Dependency Review, which don't exist in the repo.
   - **Scheduled-event logs:** these need `Partials.User` to log uncached users.
   - **Deleted ticket channel:** a ticket closed because its channel was deleted sends no DM or review request to its owner.
   - **Duplicate helpers:**
     - The local `tryDeleteWebhook` in `src/commands/config/config.ts:13` and `src/commands/tickets/ticket.ts:45` could use `deleteWebhookByUrl` from `src/lib/LoggingUtil.ts:69`.
     - `isStaleInteractionError` (`src/lib/GameStore.ts:189`) could move to `safe.ts`.
   - **Regex ReDoS:** user-supplied regexes in `src/lib/AutoresponderUtil.ts:55` and `src/lib/AutomodUtil.ts:250` can still hang. The length cap doesn't prevent ReDoS. A worker or timeout, or RE2, would.
   - **`/minecraft link`:** stores an unverified name that `/api/team` exposes.
   - **Gamble odds:** some games are positive expected value with the Gambler's Dice and Insurance items.

## 7. Conventions and things not to break

Read `AGENTS.md`. It was updated with the brand helpers, the migration rules and the presence opt-in. The key rules:

**Discord interactions**
- CV2 messages need `CV2_FLAG`. Never send `content` together with CV2 (error 50035).
- Ephemeral is always `flags: MessageFlags.Ephemeral`.
- Select menus respond with `update()` or `deferUpdate()` first.
- `showModal` must be the only response.
- Stale interaction codes 10062 and 40060 are discarded silently.

**Sapphire pieces**
- A piece without a `name` is named after its file, and a duplicate name silently unloads the earlier piece. Give every listener a unique explicit `name`.
- Subcommand errors arrive as `chatInputSubcommandError`.

**Database**
- Never renumber or regenerate migrations.
- Commit each `drizzle/NNNN_*.sql` together with `drizzle/meta/`.
- The 0000 journal `when` is pinned on purpose.
- Use `bigint({ mode: 'number' })` for epoch-ms timestamps and ms durations.
- mysql2 `affectedRows` counts *matched* rows (FOUND_ROWS). Claim patterns rely on a guarded `WHERE` clause.

**Moderation**
- Keep the `ModerationUtil` `GuildMember.prototype.timeout` patch plus `bypassTimeoutUpdate`.
- Keep `createInfraction`'s auto-linking (unban↔ban, untimeout↔timeout).
- The audit-log listener skips actions where the bot is the executor.
- `clearTempbans()` runs on every ban and unban path.

**Other**
- Music: Moonlink's own autoplay stays off. `AutoplayManager` owns autoplay, and `retryFailedTracks` stays `false`.
- Branding: use `BOT_NAME`, `USER_AGENT` and `WEBHOOK_NAMES` from `src/lib/brand.ts`. Never hard-code domains or server addresses.

---

## Appendix A: harness script

This script loads every Sapphire piece the way `client.login()` does, without connecting to Discord, and checks:
- that every command builds through Sapphire's own registry;
- the 8000-character limit;
- that subcommand mappings match the registered command tree;
- that every listener and precondition file loads as its own piece, with no name collisions.

It needs a reachable MySQL in `DATABASE_URL`, because importing the database module runs migrations.

```ts
import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-subcommands/register';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationCommandRegistries, container, SapphireClient } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';

const ROOT = process.env.HARNESS_ROOT ?? '/home/user/erica-bot/src';
const problems: string[] = [];

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
	});
}

const client = new SapphireClient({
	intents: [GatewayIntentBits.Guilds],
	baseUserDirectory: ROOT,
	loadMessageCommandListeners: false,
	logger: { level: 40 },
});
(container as any).music = new Proxy({}, { get: () => () => undefined });

// Mirror SapphireClient.login() minus the gateway connection.
client.stores.registerPath(ROOT);
for (const plugin of (SapphireClient as any).plugins.values('preLogin')) await plugin.hook.call(client, client.options);
await Promise.all([...client.stores.values()].map((store) => store.loadAll()));

const commands = client.stores.get('commands');
const seen = new Map<string, string>();
let chatCount = 0;
let ctxCount = 0;
for (const command of commands.values()) {
	const registry = ApplicationCommandRegistries.acquire(command.name);
	try {
		await (command as any).registerApplicationCommands?.(registry);
	} catch (err) {
		problems.push(`[command ${command.name}] registerApplicationCommands threw: ${(err as Error).message}`);
		continue;
	}
	for (const call of (registry as any).apiCalls as { builtData: any }[]) {
		const data = call.builtData;
		const key = `${data.type ?? 1}:${data.name}`;
		if (seen.has(key)) problems.push(`[command ${command.name}] duplicate application command ${key}`);
		seen.set(key, command.name);
		// Discord limit: combined length of every name/description/choice value (incl. localizations) ≤ 8000
		const countChars = (node: any): number => {
			if (!node || typeof node !== 'object') return 0;
			let n = 0;
			for (const k of ['name', 'description', 'value']) if (typeof node[k] === 'string') n += node[k].length;
			for (const k of ['name_localizations', 'description_localizations'])
				if (node[k]) n += Object.values(node[k] as Record<string, string>).reduce((a, s) => a + (s?.length ?? 0), 0);
			for (const child of [...(node.options ?? []), ...(node.choices ?? [])]) n += countChars(child);
			return n;
		};
		const size = countChars(data);
		if (size > 8000) problems.push(`[command ${data.name}] ${size} combined chars > 8000`);
		if ((data.type ?? 1) === 1) chatCount++;
		else ctxCount++;

		const mappings = (command as any).parsedSubcommandMappings as any[] | undefined;
		if ((data.type ?? 1) === 1 && mappings?.length) {
			const opts = (data.options ?? []) as any[];
			const topSubs = new Set(opts.filter((o) => o.type === 1).map((o) => o.name));
			const groups = new Map(
				opts.filter((o) => o.type === 2).map((g) => [g.name, new Set((g.options ?? []).map((o: any) => o.name))]),
			);
			for (const m of mappings) {
				if (m.type === 'group') {
					const g = groups.get(m.name);
					if (!g) {
						problems.push(`[command ${data.name}] mapped group '${m.name}' not registered`);
						continue;
					}
					for (const e of m.entries ?? []) {
						if (!g.has(e.name)) problems.push(`[command ${data.name}] mapped '${m.name} ${e.name}' not registered`);
						if (typeof e.chatInputRun === 'string' && typeof (command as any)[e.chatInputRun] !== 'function')
							problems.push(`[command ${data.name}] handler ${e.chatInputRun} missing`);
					}
				} else {
					if (!topSubs.has(m.name)) problems.push(`[command ${data.name}] mapped '${m.name}' not registered at top level`);
					if (typeof m.chatInputRun === 'string' && typeof (command as any)[m.chatInputRun] !== 'function')
						problems.push(`[command ${data.name}] handler ${m.chatInputRun} missing`);
				}
			}
			const mappedTop = new Set(mappings.filter((m) => m.type !== 'group').map((m) => m.name));
			for (const s of topSubs) if (!mappedTop.has(s)) problems.push(`[command ${data.name}] '${s}' has no mapping`);
			for (const [gName, subs] of groups) {
				const gm = mappings.find((m) => m.type === 'group' && m.name === gName);
				for (const s of subs)
					if (!gm?.entries?.some((e: any) => e.name === s)) problems.push(`[command ${data.name}] '${gName} ${s}' has no mapping`);
			}
		}
	}
}
const commandFiles = walk(join(ROOT, 'commands'));
if (commands.size !== commandFiles.length) problems.push(`commands: ${commandFiles.length} files but ${commands.size} pieces loaded`);

for (const [storeName, dir] of [
	['listeners', 'listeners'],
	['preconditions', 'preconditions'],
] as const) {
	const store = client.stores.get(storeName);
	const loaded = new Set([...store.values()].map((p: any) => p.location.full));
	for (const f of walk(join(ROOT, dir))) if (!loaded.has(f)) problems.push(`[${storeName}] ${f} not loaded (name collision?)`);
}

console.log(`chat-input: ${chatCount}, context-menu: ${ctxCount}, listener pieces: ${client.stores.get('listeners').size}`);
if (problems.length) {
	console.log(`\n${problems.length} problem(s):`);
	for (const p of problems) console.log(` - ${p}`);
	process.exit(1);
}
console.log('OK — all commands registered cleanly, no piece collisions.');
process.exit(0);
```
