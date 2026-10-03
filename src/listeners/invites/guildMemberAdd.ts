import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { grantInviteRewards, recordInviteJoin } from '../../lib/InviteTrackingUtil.js';
import { getJoinInvite } from '../../lib/InviteUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'inviteTrackingJoin',
	event: Events.GuildMemberAdd,
})
export class InviteTrackingJoinListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		if (member.user.bot) return;

		// Always run the detection (shared with the join logger) so the invite cache keeps
		// up with use counts even while Invite Tracking is off.
		const invite = await getJoinInvite(member);
		if (!(await isModuleEnabled(member.guild.id, 'inviteTracking'))) return;

		try {
			await recordInviteJoin(member, invite);
			if (invite?.inviterId) await grantInviteRewards(member.guild, invite.inviterId);
		} catch (err) {
			this.container.logger.error(`[invites] failed to record join of ${member.id} in ${member.guild.id}:`, err);
		}
	}
}
