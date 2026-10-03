import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { markInviteLeft } from '../../lib/InviteTrackingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'inviteTrackingLeave',
	event: Events.GuildMemberRemove,
})
export class InviteTrackingLeaveListener extends Listener<typeof Events.GuildMemberRemove> {
	public override async run(member: GuildMember | PartialGuildMember) {
		if (member.user?.bot) return;
		if (!(await isModuleEnabled(member.guild.id, 'inviteTracking'))) return;

		try {
			await markInviteLeft(member.guild.id, member.id);
		} catch (err) {
			this.container.logger.error(`[invites] failed to record leave of ${member.id} in ${member.guild.id}:`, err);
		}
	}
}
