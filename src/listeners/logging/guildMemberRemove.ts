import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { AuditLogEvent, Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { LogEmpty, logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'guildMemberRemoveLogging',
	event: Events.GuildMemberRemove,
})
export class GuildMemberRemoveListener extends Listener<typeof Events.GuildMemberRemove> {
	public override async run(member: GuildMember | PartialGuildMember) {
		if (member.user?.bot) return;
		if (!(await isModuleEnabled(member.guild.id, 'logging'))) return;

		// Wait briefly for the audit log to populate, then check if this was a kick or ban.
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 1500);
		});

		const now = Date.now();
		const recentWindow = 5000;
		const [kickLogs, banLogs] = await Promise.all([
			member.guild.fetchAuditLogs({ limit: 3, type: AuditLogEvent.MemberKick }).catch(() => null),
			member.guild.fetchAuditLogs({ limit: 3, type: AuditLogEvent.MemberBanAdd }).catch(() => null),
		]);
		const wasKicked = kickLogs?.entries.some(
			(e) => e.target?.id === member.id && now - e.createdTimestamp < recentWindow,
		);
		const wasBanned = banLogs?.entries.some(
			(e) => e.target?.id === member.id && now - e.createdTimestamp < recentWindow,
		);
		if (wasKicked || wasBanned) return;

		const user = member.user ?? (await member.guild.client.users.fetch(member.id).catch(() => null));

		const roles = member.partial
			? LogEmpty.notCached
			: member.roles.cache
					.filter((r) => r.id !== member.guild.roles.everyone.id)
					.map((r) => r.toString())
					.join(', ') || LogEmpty.none;

		await sendLog(
			member.guild,
			logContainer({
				title: 'Member Left',
				color: Colors.Warning,
				fields: [
					user ? logFields.user(member.id) : { name: 'User', value: `\`${member.id}\`` },
					member.joinedAt
						? logFields.joined(Math.floor(member.joinedAt.getTime() / 1000))
						: { name: 'Joined', value: LogEmpty.unknown },
					{ name: 'Roles', value: roles },
					logFields.memberCount(member.guild.memberCount),
				],
				timestamp: true,
				targetUser: user ?? undefined,
			}),
		).catch(() => null);
	}
}
