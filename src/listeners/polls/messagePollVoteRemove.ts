import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, type PollAnswer, type Snowflake, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'messagePollVoteRemove',
	event: Events.MessagePollVoteRemove,
})
export class MessagePollVoteRemoveListener extends Listener<typeof Events.MessagePollVoteRemove> {
	public override async run(pollAnswer: PollAnswer, userId: Snowflake) {
		const rawMsg = pollAnswer.poll.message;

		const guildId = rawMsg.guildId;
		if (!guildId) return;

		const guild = this.container.client.guilds.cache.get(guildId);
		if (!guild) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const [userResult, msgResult] = await Promise.allSettled([
			this.container.client.users.fetch(userId),
			rawMsg.partial ? rawMsg.fetch() : Promise.resolve(rawMsg),
		]);

		const user = userResult.status === 'fulfilled' ? userResult.value : null;
		const userValue = user
			? `${userMention(user.id)} (${user.username} • \`${user.id}\`)`
			: `${userMention(userId)} (\`${userId}\`)`;

		const message = msgResult.status === 'fulfilled' ? msgResult.value : null;

		let fullMessage = message;
		if (fullMessage && (!fullMessage.poll?.question.text || !fullMessage.poll.answers.has(pollAnswer.id))) {
			fullMessage = await fullMessage.fetch().catch(() => fullMessage);
		}

		const poll = fullMessage?.poll ?? pollAnswer.poll;
		const answer = poll.answers.get(pollAnswer.id) ?? pollAnswer;

		const jumpUrl = `https://discord.com/channels/${guildId}/${rawMsg.channelId}/${rawMsg.id}`;

		await sendLog(
			guild,
			logContainer({
				title: 'Poll Vote Removed',
				color: Colors.Warning,
				fields: [
					{ name: 'User', value: userValue },
					{ name: 'Channel', value: channelMention(rawMsg.channelId) },
					{ name: 'Question', value: poll.question.text ?? '*(unavailable)*' },
					{ name: 'Answer', value: answer.text ?? `Answer #${pollAnswer.id}` },
					{ name: 'Jump', value: `[View Poll](${jumpUrl})` },
				],
				timestamp: true,
			}),
			rawMsg.channelId,
		).catch(() => null);
	}
}
