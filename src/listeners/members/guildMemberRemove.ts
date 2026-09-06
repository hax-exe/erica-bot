import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { CV2_FLAG } from '../../lib/components.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { buildLeaveContainer, getLeaveSettings } from '../../lib/WelcomeUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'leaveOnGuildMemberRemove',
	event: Events.GuildMemberRemove,
})
export class LeaveListener extends Listener<typeof Events.GuildMemberRemove> {
	public override async run(member: GuildMember | PartialGuildMember) {
		const settings = await getLeaveSettings(member.guild.id);
		if (!settings?.enabled || !settings.channelId) return;
		if (!(await isModuleEnabled(member.guild.id, 'welcomer'))) return;

		const channel = member.guild.channels.cache.get(settings.channelId);
		if (!channel?.isTextBased()) return;

		const container = buildLeaveContainer(settings, member);
		await (channel.send as (options: unknown) => Promise<unknown>)({ components: [container], flags: CV2_FLAG }).catch(
			(err: unknown) => {
				this.container.logger.error('[welcomer] Failed to send leave message:', err);
			},
		);
	}
}
