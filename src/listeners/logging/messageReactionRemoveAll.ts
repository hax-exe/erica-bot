import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	channelMention,
	Events,
	type Message,
	type MessageReaction,
	type PartialMessage,
	type ReadonlyCollection,
} from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageReactionRemoveAllLogging',
	event: Events.MessageReactionRemoveAll,
})
export class MessageReactionRemoveAllListener extends Listener<typeof Events.MessageReactionRemoveAll> {
	public override async run(
		message: Message | PartialMessage,
		_reactions: ReadonlyCollection<string, MessageReaction>,
	) {
		if (!message.guild) return;
		if (!(await isModuleEnabled(message.guild.id, 'logging'))) return;

		await sendLog(
			message.guild,
			logContainer({
				title: 'All Reactions Cleared',
				color: Colors.Warning,
				fields: [
					{ name: 'Channel', value: channelMention(message.channelId) },
					{
						name: 'Message',
						value: message.url ? `[Jump to message](${message.url})` : `\`${message.id}\``,
					},
				],
				timestamp: true,
			}),
			message.channelId,
		).catch(() => null);
	}
}
