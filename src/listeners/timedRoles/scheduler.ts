import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';

/** Discord errors that no retry can fix: unknown channel/guild/member/role, missing access/permissions, DMs closed. */
const PERMANENT_DISCORD_ERRORS = new Set([10003, 10004, 10007, 10011, 50001, 50007, 50013]);

function permanentDiscordErrorCode(err: unknown): number | null {
	const code = (err as { code?: unknown } | null)?.code;
	return typeof code === 'number' && PERMANENT_DISCORD_ERRORS.has(code) ? code : null;
}

@ApplyOptions<Listener.Options>({
	name: 'timedRoleScheduler',
	event: Events.ClientReady,
	once: true,
})
export class TimedRoleSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		let running = false;
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const now = new Date();
				const expired = await db.query.timedRoles.findMany({
					where: and(eq(schema.timedRoles.done, false), lte(schema.timedRoles.expiresAt, now)),
				});

				for (const row of expired) {
					try {
						const guild = client.guilds.cache.get(row.guildId) ?? (await client.guilds.fetch(row.guildId));
						const member = await guild.members.fetch(row.userId);
						await member.roles.remove(row.roleId);
						await db.update(schema.timedRoles).set({ done: true }).where(eq(schema.timedRoles.id, row.id));
					} catch (err) {
						const code = permanentDiscordErrorCode(err);
						if (code === null) {
							// Transient (network / 5xx / DB) — keep pending so the next tick retries.
							client.logger.warn(`[TimedRoleScheduler] Failed to remove timed role ${row.id}; will retry:`, err);
							continue;
						}
						// Left the guild / member gone / role deleted / role above mine… — retrying can't succeed.
						client.logger.warn(
							`[TimedRoleScheduler] Giving up on timed role ${row.id} (Discord error ${code}: ${(err as Error).message}).`,
						);
						await db
							.update(schema.timedRoles)
							.set({ done: true })
							.where(eq(schema.timedRoles.id, row.id))
							.catch((dbErr) =>
								client.logger.error(`[TimedRoleScheduler] Failed to retire timed role ${row.id}:`, dbErr),
							);
					}
				}
			} catch (err) {
				client.logger.error('[TimedRoleScheduler] Error during check:', err);
			} finally {
				running = false;
			}
		};

		check();
		setInterval(check, 60_000);
	}
}
