import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, type MessageReaction, type PartialMessageReaction } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageReactionRemoveEmojiLogging',
	event: Events.MessageReactionRemoveEmoji,
})
export class MessageReactionRemoveEmojiListener extends Listener<typeof Events.MessageReactionRemoveEmoji> {
	public override async run(reaction: MessageReaction | PartialMessageReaction) {
		// Fetch if partial to get complete emoji data
		const fullReaction = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;

		if (!fullReaction.message.guild) return;
		if (!(await isModuleEnabled(fullReaction.message.guild.id, 'logging'))) return;

		const emoji = fullReaction.emoji.id
			? `<${fullReaction.emoji.animated ? 'a' : ''}:${fullReaction.emoji.name ?? '?'}:${fullReaction.emoji.id}>`
			: (fullReaction.emoji.name ?? '?');

		await sendLog(
			fullReaction.message.guild,
			logContainer({
				title: 'Emoji Reactions Cleared',
				color: Colors.Warning,
				fields: [
					{ name: 'Emoji', value: emoji },
					{ name: 'Channel', value: channelMention(fullReaction.message.channelId) },
					{
						name: 'Message',
						value: fullReaction.message.url
							? `[Jump to message](${fullReaction.message.url})`
							: `\`${fullReaction.message.id}\``,
					},
				],
				thumbnailUrl: fullReaction.emoji.imageURL() ?? undefined,
				timestamp: true,
			}),
			fullReaction.message.channelId,
		).catch(() => null);
	}
}
