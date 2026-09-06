import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	type AnyThreadChannel,
	type Collection,
	channelMention,
	Events,
	type Snowflake,
	type ThreadMember,
	userMention,
} from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// Requires the GUILD_MEMBERS privileged intent to receive added/removed member objects.

@ApplyOptions<Listener.Options>({
	name: 'threadMembersUpdateLogging',
	event: Events.ThreadMembersUpdate,
})
export class ThreadMembersUpdateListener extends Listener<typeof Events.ThreadMembersUpdate> {
	public override async run(
		addedMembers: Collection<Snowflake, ThreadMember>,
		removedMembers: Collection<Snowflake, ThreadMember>,
		thread: AnyThreadChannel,
	) {
		const guild = thread.guild;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const humanAdded = addedMembers.filter((m) => !m.user?.bot);
		const humanRemoved = removedMembers.filter((m) => !m.user?.bot);

		if (humanAdded.size > 0) {
			const list = humanAdded.map((m) => (m.user ? `${formatUser(m.id)}` : `\`${m.id}\``)).join('\n');
			await sendLog(
				guild,
				logContainer({
					title: 'Thread Members Joined',
					color: Colors.Info,
					fields: [
						{ name: 'Thread', value: channelMention(thread.id) },
						{ name: `Members (${humanAdded.size})`, value: list.length > 1024 ? `${list.slice(0, 1020)}…` : list },
					],
					timestamp: true,
				}),
				thread.id,
			).catch(() => null);
		}

		if (humanRemoved.size > 0) {
			const list = humanRemoved.map((m) => (m.user ? `${formatUser(m.id)}` : `\`${m.id}\``)).join('\n');
			await sendLog(
				guild,
				logContainer({
					title: 'Thread Members Left',
					color: Colors.Neutral,
					fields: [
						{ name: 'Thread', value: channelMention(thread.id) },
						{ name: `Members (${humanRemoved.size})`, value: list.length > 1024 ? `${list.slice(0, 1020)}…` : list },
					],
					timestamp: true,
				}),
				thread.id,
			).catch(() => null);
		}
	}
}
