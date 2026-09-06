import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message, type PartialMessage } from 'discord.js';
import { recordDeleted } from '../../lib/SnipeStore.js';

@ApplyOptions<Listener.Options>({
	name: 'snipeMessageDelete',
	event: Events.MessageDelete,
})
export class SnipeMessageDeleteListener extends Listener<typeof Events.MessageDelete> {
	public override run(message: Message | PartialMessage) {
		if (!message.guild || message.author?.bot) return;
		const content = message.content?.trim() ?? '';
		const attachments = [...(message.attachments?.values() ?? [])].map((a) => a.url).slice(0, 5);
		if (!content && attachments.length === 0) return;

		recordDeleted(message.channelId, {
			content: content.slice(0, 1900),
			authorId: message.author?.id ?? '0',
			authorTag: message.author?.tag ?? 'Unknown',
			avatarUrl: message.author?.displayAvatarURL({ size: 128 }) ?? '',
			createdAt: message.createdTimestamp,
			snipedAt: Date.now(),
			attachments,
		});
	}
}
