import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';

/**
 * Discord errors that no retry can fix: the guild, member or role is gone. Missing permissions are
 * NOT here — those are retried, otherwise the member would silently keep the role forever.
 */
const PERMANENT_DISCORD_ERRORS = new Set([10004, 10007, 10011]);

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
		/** Timed roles whose removal already logged a permission failure (retried silently afterwards). */
		const permissionWarned = new Set<number>();
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const now = new Date();
				const expired = await db.query.timedRoles.findMany({
					where: and(eq(schema.timedRoles.done, false), lte(schema.timedRoles.expiresAt, now)),
				});

				const retire = (rowId: number, why: string) => {
					client.logger.warn(`[TimedRoleScheduler] Giving up on timed role ${rowId}: ${why}`);
					return db
						.update(schema.timedRoles)
						.set({ done: true })
						.where(eq(schema.timedRoles.id, rowId))
						.catch((dbErr) => client.logger.error(`[TimedRoleScheduler] Failed to retire timed role ${rowId}:`, dbErr));
				};

				for (const row of expired) {
					try {
						// The guild cache holds every guild the bot is in (this runs after ready).
						const guild = client.guilds.cache.get(row.guildId);
						if (!guild) {
							await retire(row.id, `I am no longer in guild ${row.guildId}.`);
							continue;
						}
						if (!guild.available) continue; // Discord outage — retry later

						const member = await guild.members.fetch(row.userId);
						await member.roles.remove(row.roleId);
						await db.update(schema.timedRoles).set({ done: true }).where(eq(schema.timedRoles.id, row.id));
						permissionWarned.delete(row.id);
					} catch (err) {
						const code = permanentDiscordErrorCode(err);
						if (code !== null) {
							// Member gone / role deleted — retrying can't succeed.
							await retire(row.id, `Discord error ${code} (${(err as Error).message}).`);
							continue;
						}
						// Transient (network / 5xx / DB) or missing permissions — keep pending so the next tick
						// retries. A permission problem only needs fixing once, so it is reported once.
						const errCode = (err as { code?: unknown } | null)?.code;
						const isPermission = errCode === 50001 || errCode === 50013;
						if (!isPermission || !permissionWarned.has(row.id)) {
							if (isPermission) permissionWarned.add(row.id);
							client.logger.warn(`[TimedRoleScheduler] Failed to remove timed role ${row.id}; will retry:`, err);
						}
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
