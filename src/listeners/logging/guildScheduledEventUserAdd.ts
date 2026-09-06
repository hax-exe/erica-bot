import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildScheduledEvent, type User, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'guildScheduledEventUserAddLogging',
	event: Events.GuildScheduledEventUserAdd,
})
export class GuildScheduledEventUserAddListener extends Listener<typeof Events.GuildScheduledEventUserAdd> {
	public override async run(guildScheduledEvent: GuildScheduledEvent, user: User) {
		const guild = guildScheduledEvent.guild ?? guildScheduledEvent.client.guilds.cache.get(guildScheduledEvent.guildId);
		if (!guild) return;
		if (user.bot) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		await sendLog(
			guild,
			logContainer({
				title: 'Scheduled Event Subscribed',
				color: Colors.Info,
				fields: [
					{ name: 'User', value: `${formatUser(user.id, user.username)}` },
					{ name: 'Event', value: guildScheduledEvent.name },
				],
				timestamp: true,
			}),
		).catch(() => null);
	}
}
