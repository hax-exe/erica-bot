import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type PartialGuildMember } from 'discord.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { saveMemberSnapshot } from '../../lib/RolePersistUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'rolePersistOnGuildMemberRemove',
	event: Events.GuildMemberRemove,
})
export class RolePersistRemoveListener extends Listener<typeof Events.GuildMemberRemove> {
	public override async run(member: GuildMember | PartialGuildMember) {
		// A partial member has no role data to save.
		if (member.partial) return;
		if (member.user.bot) return;

		try {
			if (!(await isModuleEnabled(member.guild.id, 'rolePersistence'))) return;
			await saveMemberSnapshot(member);
		} catch (err) {
			this.container.logger.error(`[rolepersist] Failed to save roles for ${member.id} in ${member.guild.id}:`, err);
		}
	}
}
