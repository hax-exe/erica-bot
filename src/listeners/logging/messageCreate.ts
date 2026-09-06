import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messageCreateLogging',
	event: Events.MessageCreate,
})
export class MessageCreateListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (!message.guild || message.author.bot) return;
		if (!(await isModuleEnabled(message.guild.id, 'logging'))) return;

		// Only log poll creation — logging every message floods webhooks and hits rate limits.
		if (!message.poll) return;

		const answers = [...message.poll.answers.values()].map((a) => a.text ?? 'N/A');

		await sendLog(
			message.guild,
			logContainer({
				title: 'Poll Created',
				color: Colors.Info,
				fields: [
					logFields.user(message.author.id),
					logFields.channel(message.channelId),
					{ name: 'Question', value: message.poll.question.text ?? 'N/A' },
					{ name: 'Answers', value: answers.map((a, i) => `${i + 1}. ${a}`).join('\n') || 'N/A' },
				],
				timestamp: true,
				targetUser: message.author,
			}),
			message.channelId,
		).catch(() => null);
	}
}
