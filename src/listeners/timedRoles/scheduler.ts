import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';

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
						const guild =
							client.guilds.cache.get(row.guildId) ?? (await client.guilds.fetch(row.guildId).catch(() => null));
						if (!guild) continue;
						const member = await guild.members.fetch(row.userId).catch(() => null);
						if (member) await member.roles.remove(row.roleId);
						await db.update(schema.timedRoles).set({ done: true }).where(eq(schema.timedRoles.id, row.id));
					} catch {
						// Keep pending so permission/API failures are retried.
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
