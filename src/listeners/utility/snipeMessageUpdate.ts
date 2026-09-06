import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message, type PartialMessage } from 'discord.js';
import { recordEdited } from '../../lib/SnipeStore.js';

@ApplyOptions<Listener.Options>({
	name: 'snipeMessageUpdate',
	event: Events.MessageUpdate,
})
export class SnipeMessageUpdateListener extends Listener<typeof Events.MessageUpdate> {
	public override run(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
		if (!oldMessage.guild || oldMessage.author?.bot) return;
		const before = oldMessage.content ?? '';
		const after = newMessage.content ?? '';
		if (!before || before === after) return;

		recordEdited(oldMessage.channelId, {
			content: after.slice(0, 1900),
			beforeContent: before.slice(0, 1900),
			authorId: oldMessage.author?.id ?? '0',
			authorTag: oldMessage.author?.tag ?? 'Unknown',
			avatarUrl: oldMessage.author?.displayAvatarURL({ size: 128 }) ?? '',
			createdAt: oldMessage.createdTimestamp,
			snipedAt: Date.now(),
			attachments: [],
		});
	}
}
