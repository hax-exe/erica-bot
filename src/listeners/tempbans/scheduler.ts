import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { eq, lte } from 'drizzle-orm';
import { db, schema } from '../../lib/database.js';
import { createInfraction, dispatchModLog } from '../../lib/ModerationUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'tempbanScheduler',
	event: Events.ClientReady,
	once: true,
})
export class TempbanSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		let running = false;
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const now = new Date();
				const expired = await db.query.tempbans.findMany({
					where: lte(schema.tempbans.expiresAt, now),
				});

				for (const entry of expired) {
					try {
						const guild = client.guilds.cache.get(entry.guildId);
						if (!guild) {
							// Guild unavailable — keep the row and retry later
							continue;
						}

						// Unban first; only delete the DB row after a successful remove
						// (or if the ban is already gone — Discord 10026 Unknown Ban).
						try {
							await guild.bans.remove(entry.userId, 'Temp ban expired');
						} catch (err: any) {
							if (err?.code !== 10026) {
								client.logger.warn(`[TempbanScheduler] Failed to unban ${entry.userId} in ${entry.guildId}:`, err);
								continue;
							}
						}

						await db.delete(schema.tempbans).where(eq(schema.tempbans.id, entry.id));

						const target = await client.users.fetch(entry.userId).catch(() => null);
						if (!target) continue;

						const infraction = await createInfraction({
							guildId: guild.id,
							userId: entry.userId,
							moderatorId: client.user.id,
							type: 'unban',
							reason: 'Temp ban expired',
						});

						await dispatchModLog({
							guild,
							targetUser: target,
							moderator: client.user,
							type: 'unban',
							reason: 'Temp ban expired',
							caseId: infraction.caseId,
						});
					} catch (err) {
						client.logger.error(`[TempbanScheduler] Error processing tempban ${entry.id}:`, err);
					}
				}
			} catch (err) {
				client.logger.error('[TempbanScheduler] Error during check:', err);
			} finally {
				running = false;
			}
		};

		void check();
		setInterval(() => void check(), 60_000);
	}
}
