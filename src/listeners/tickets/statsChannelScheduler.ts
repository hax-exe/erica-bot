import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type Client, Events } from 'discord.js';
import { updateTicketStatsChannels } from '../../lib/TicketStatsChannelUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'ticketStatsChannelScheduler',
	event: Events.ClientReady,
	once: true,
})
export class TicketStatsChannelSchedulerListener extends Listener<typeof Events.ClientReady> {
	public override run(client: Client<true>) {
		const updateAll = async () => {
			for (const guild of client.guilds.cache.values()) {
				await updateTicketStatsChannels(guild).catch(() => null);
			}
		};

		updateAll();
		setInterval(updateAll, 10 * 60 * 1000);
	}
}
