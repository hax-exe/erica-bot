import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message, type PartialMessage } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { LogEmpty, logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageUpdateLogging',
	event: Events.MessageUpdate,
})
export class MessageUpdateListener extends Listener<typeof Events.MessageUpdate> {
	public override async run(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage) {
		const msg = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
		if (!msg?.guild || msg.author?.bot) return;
		if (oldMessage.content !== null && oldMessage.content === msg.content) return;
		if (!(await isModuleEnabled(msg.guild.id, 'logging'))) return;

		const truncate = (s: string | null | undefined, max = 1000) =>
			s ? (s.length > max ? `${s.slice(0, max)}…` : s) : LogEmpty.notCached;

		await sendLog(
			msg.guild,
			logContainer({
				title: 'Message Edited',
				color: Colors.Message,
				fields: [
					logFields.user(msg.author.id),
					logFields.channel(msg.channelId),
					logFields.before(truncate(oldMessage.content)),
					logFields.after(truncate(msg.content)),
					logFields.jump(msg.url),
				],
				timestamp: true,
				targetUser: msg.author,
			}),
			msg.channelId,
		).catch(() => null);
	}
}
