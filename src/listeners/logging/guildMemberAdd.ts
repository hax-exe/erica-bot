import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { detectUsedInvite } from '../../lib/InviteUtil.js';
import { LogEmpty, logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'guildMemberAddLogging',
	event: Events.GuildMemberAdd,
})
export class GuildMemberAddListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		if (member.user.bot) return;
		if (!(await isModuleEnabled(member.guild.id, 'logging'))) return;

		const invite = await detectUsedInvite(member.guild);
		const inviteValue = invite
			? invite.inviterId
				? `\`${invite.code}\` · created by <@${invite.inviterId}> · ${invite.uses} use${invite.uses === 1 ? '' : 's'}`
				: `\`${invite.code}\` · ${invite.uses} use${invite.uses === 1 ? '' : 's'}`
			: LogEmpty.unknown;

		await sendLog(
			member.guild,
			logContainer({
				title: 'Member Joined',
				color: Colors.Success,
				fields: [
					logFields.user(member.id),
					logFields.accountCreated(Math.floor(member.user.createdTimestamp / 1000)),
					{ name: 'Invite Used', value: inviteValue },
					logFields.memberCount(member.guild.memberCount),
				],
				timestamp: true,
				targetUser: member.user,
			}),
		).catch(() => null);
	}
}
