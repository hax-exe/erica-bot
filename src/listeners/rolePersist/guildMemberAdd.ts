import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { formatRoleList, restoreMemberSnapshot } from '../../lib/RolePersistUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'rolePersistOnGuildMemberAdd',
	event: Events.GuildMemberAdd,
})
export class RolePersistAddListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		if (member.user.bot) return;

		try {
			if (!(await isModuleEnabled(member.guild.id, 'rolePersistence'))) return;

			const result = await restoreMemberSnapshot(member);
			if (!result || (result.restoredRoleIds.length === 0 && !result.nickname)) return;
			if (!(await isModuleEnabled(member.guild.id, 'logging'))) return;

			const fields = [logFields.user(member.id), { name: 'Roles', value: formatRoleList(result.restoredRoleIds) }];
			if (result.nickname) fields.push({ name: 'Nickname', value: result.nickname });
			if (result.skippedCount > 0) {
				fields.push({
					name: 'Skipped',
					value: `${result.skippedCount} saved role${result.skippedCount === 1 ? '' : 's'} could not be restored`,
				});
			}
			fields.push({ name: 'Left', value: `<t:${Math.floor(result.savedAt / 1000)}:R>` });

			await sendLog(
				member.guild,
				logContainer({
					title: 'Roles Restored',
					color: Colors.Success,
					fields,
					timestamp: true,
					targetUser: member.user,
				}),
			);
		} catch (err) {
			this.container.logger.error(`[rolepersist] Failed to restore roles for ${member.id} in ${member.guild.id}:`, err);
		}
	}
}
