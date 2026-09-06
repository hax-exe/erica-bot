import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { updateStatsChannels } from '../../lib/StatsChannelUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'statsChannelScheduler',
	event: Events.ClientReady,
	once: true,
})
export class StatsChannelSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		const updateAll = async () => {
			for (const guild of client.guilds.cache.values()) {
				await updateStatsChannels(guild).catch(() => null);
			}
		};

		// Run once immediately, then every 10 minutes
		updateAll();
		setInterval(updateAll, 10 * 60 * 1000);
	}
}
