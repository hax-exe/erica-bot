import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	channelMention,
	Events,
	type MessageReaction,
	type PartialMessageReaction,
	type PartialUser,
	type User,
} from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageReactionRemoveLogging',
	event: Events.MessageReactionRemove,
})
export class MessageReactionRemoveListener extends Listener<typeof Events.MessageReactionRemove> {
	public override async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		// Fetch user first — needed to check .bot. Reaction fetch may fail if count hit 0,
		// so fall back to the partial rather than bailing entirely.
		const fullUser = user.partial ? await user.fetch().catch(() => null) : user;
		if (!fullUser || fullUser.bot) return;

		const fullReaction = reaction.partial ? await reaction.fetch().catch(() => reaction) : reaction;

		if (!fullReaction.message.guild) return;
		if (!(await isModuleEnabled(fullReaction.message.guild.id, 'logging'))) return;

		const emoji = fullReaction.emoji.id
			? `<${fullReaction.emoji.animated ? 'a' : ''}:${fullReaction.emoji.name ?? '?'}:${fullReaction.emoji.id}>`
			: (fullReaction.emoji.name ?? '?');

		await sendLog(
			fullReaction.message.guild,
			logContainer({
				title: 'Reaction Removed',
				color: Colors.Neutral,
				fields: [
					{ name: 'User', value: `${formatUser(fullUser.id)}` },
					{ name: 'Emoji', value: emoji },
					{ name: 'Channel', value: channelMention(fullReaction.message.channelId) },
					{ name: 'Remaining', value: String(fullReaction.count ?? 0) },
				],
				thumbnailUrl: fullReaction.emoji.imageURL() ?? undefined,
				timestamp: true,
			}),
			fullReaction.message.channelId,
		).catch(() => null);
	}
}
