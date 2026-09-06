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
	name: 'messageReactionAddLogging',
	event: Events.MessageReactionAdd,
})
export class MessageReactionAddListener extends Listener<typeof Events.MessageReactionAdd> {
	public override async run(reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) {
		// Fetch both partials — needed to get complete emoji data and to check .bot
		const fullReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
		if (!fullReaction) return;

		const fullUser = user.partial ? await user.fetch().catch(() => null) : user;
		if (!fullUser || fullUser.bot) return;

		if (!fullReaction.message.guild) return;
		if (!(await isModuleEnabled(fullReaction.message.guild.id, 'logging'))) return;

		const emoji = fullReaction.emoji.id
			? `<${fullReaction.emoji.animated ? 'a' : ''}:${fullReaction.emoji.name ?? '?'}:${fullReaction.emoji.id}>`
			: (fullReaction.emoji.name ?? '?');

		await sendLog(
			fullReaction.message.guild,
			logContainer({
				title: 'Reaction Added',
				color: Colors.Neutral,
				fields: [
					{ name: 'User', value: `${formatUser(fullUser.id)}` },
					{ name: 'Emoji', value: emoji },
					{ name: 'Channel', value: channelMention(fullReaction.message.channelId) },
					{ name: 'Total', value: String(fullReaction.count ?? 1) },
				],
				thumbnailUrl: fullReaction.emoji.imageURL() ?? undefined,
				timestamp: true,
			}),
			fullReaction.message.channelId,
		).catch(() => null);
	}
}
