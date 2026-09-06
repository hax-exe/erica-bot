import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, type Message, type OmitPartialGroupDMChannel, type PartialMessage } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { LogEmpty, logFields, sendLog, sendLogFiles } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageDeleteLogging',
	event: Events.MessageDelete,
})
export class MessageDeleteListener extends Listener<typeof Events.MessageDelete> {
	public override async run(message: OmitPartialGroupDMChannel<Message | PartialMessage>) {
		if (!message.guild || message.author?.bot) return;
		if (!(await isModuleEnabled(message.guild.id, 'logging'))) return;

		const author = message.author;
		const content = message.content?.slice(0, 1000) || LogEmpty.noText;

		const container = logContainer({
			title: 'Message Deleted',
			color: Colors.Message,
			fields: [
				logFields.channel(message.channelId),
				logFields.messageId(message.id),
				author ? logFields.user(author.id) : { name: 'User', value: LogEmpty.unknown },
				logFields.messageCreated(Math.floor(message.createdTimestamp / 1000)),
				logFields.message(content),
			],
			timestamp: true,
			targetUser: author ?? undefined,
		});

		await sendLog(message.guild, container, message.channelId).catch(() => null);

		const attachments = [...(message.attachments?.values() ?? [])];
		if (attachments.length > 0) {
			const { AttachmentBuilder } = await import('discord.js');

			const files = attachments.slice(0, 10).map((att) => {
				return new AttachmentBuilder(att.proxyURL || att.url, { name: att.name || 'attachment.unknown' });
			});

			const note = `-# Attachments from deleted message by **${author?.tag ?? 'Unknown User'}** in ${channelMention(message.channelId)}`;
			await sendLogFiles(message.guild, files, note, message.channelId).catch(() => null);
		}
	}
}
