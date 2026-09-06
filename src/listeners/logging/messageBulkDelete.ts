import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageBulkDeleteLogging',
	event: Events.MessageBulkDelete,
})
export class MessageBulkDeleteListener extends Listener<typeof Events.MessageBulkDelete> {
	public override async run(
		messages: import('discord.js').ReadonlyCollection<
			string,
			import('discord.js').Message<true> | import('discord.js').PartialMessage
		>,
		channel: import('discord.js').GuildTextBasedChannel,
	) {
		// Build a readable transcript of the deleted messages (oldest first, skip bots)
		const lines: string[] = [];
		const guildId = channel.guildId;
		if (!(await isModuleEnabled(guildId, 'logging'))) return;
		for (const msg of [...messages.values()].reverse()) {
			if (msg.author?.bot) continue;
			const author = msg.author?.tag ?? 'Unknown';
			const text = msg.content?.trim() || (msg.attachments?.size ? '[attachment]' : '[no content]');
			lines.push(`**${author}:** ${text.slice(0, 200)}`);
		}

		const MAX_CHARS = 3800;
		let transcript = lines.join('\n');
		if (transcript.length > MAX_CHARS) {
			transcript = `${transcript.slice(0, MAX_CHARS)}\n*(truncated)*`;
		}
		if (!transcript) transcript = '*(all messages were from bots or had no content)*';

		await sendLog(
			channel.guild,
			logContainer({
				title: 'Messages Bulk Deleted',
				color: Colors.Message,
				fields: [
					{ name: 'Channel', value: channelMention(channel.id) },
					{ name: 'Count', value: `${messages.size} messages` },
					{ name: 'Messages', value: transcript },
				],
				timestamp: true,
			}),
			channel.id,
		).catch(() => null);
	}
}
