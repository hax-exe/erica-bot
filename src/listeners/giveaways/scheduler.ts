import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { and, eq, lte } from 'drizzle-orm';
import { endGiveaway } from '../../commands/general/giveaway.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'giveawayScheduler',
	event: Events.ClientReady,
	once: true,
})
export class GiveawaySchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		let running = false;
		const check = async () => {
			if (running) return;
			running = true;
			try {
				const now = new Date();
				const expired = await db.query.giveaways.findMany({
					where: and(eq(schema.giveaways.ended, false), lte(schema.giveaways.endsAt, now)),
				});
				for (const giveaway of expired) {
					await endGiveaway(giveaway, client).catch((err) =>
						client.logger.error(`[GiveawayScheduler] Failed to end giveaway ${giveaway.id}:`, err),
					);
				}
			} catch (err) {
				client.logger.error('[GiveawayScheduler] Error during check:', err);
			} finally {
				running = false;
			}
		};

		void check();
		setInterval(() => void check(), 30_000);
	}
}
