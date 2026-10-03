import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { snapshotRestoresRole } from '../../lib/RolePersistUtil.js';
import { fetchBotMember, unsafeGrantReason } from '../../lib/RoleSafety.js';
import { getVerificationSettings } from '../../lib/VerificationUtil.js';

/** Gives new members the unverified role (when one is configured) until they verify. */
@ApplyOptions<Listener.Options>({
	name: 'verificationOnJoin',
	event: Events.GuildMemberAdd,
})
export class VerificationOnJoinListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		if (member.user.bot) return;

		try {
			if (!(await isModuleEnabled(member.guild.id, 'verification'))) return;

			const [settings, rolePersistenceOn] = await Promise.all([
				getVerificationSettings(member.guild.id),
				isModuleEnabled(member.guild.id, 'rolePersistence'),
			]);
			const unverifiedRoleId = settings?.unverifiedRoleId;
			if (!settings || !unverifiedRoleId) return;

			// A returning verified member gets the verified role back from role persistence (a listener
			// running alongside this one), so do not lock them out again with the unverified role. If the
			// snapshot cannot be read, fall back to adding the unverified role (the gate stays closed;
			// pressing Verify removes it again for a verified member).
			if (settings.roleId) {
				const restoresVerified =
					rolePersistenceOn &&
					(await snapshotRestoresRole(member, settings.roleId).catch((err: unknown) => {
						this.container.logger.warn(
							`[verification] Could not read the role persistence snapshot of ${member.id} in ${member.guild.id}:`,
							err,
						);
						return false;
					}));
				// Checked after the snapshot read so a restore that already finished is seen too.
				if (restoresVerified || member.roles.cache.has(settings.roleId)) return;
			}

			const role = member.guild.roles.cache.get(unverifiedRoleId);
			if (!role) return;
			const me = await fetchBotMember(member.guild);
			if (!me) return;
			const unsafe = unsafeGrantReason(role, me);
			if (unsafe) {
				this.container.logger.warn(`[verification] Not giving the unverified role in ${member.guild.id}: ${unsafe}`);
				return;
			}

			await member.roles.add(unverifiedRoleId, 'Member verification: awaiting verification');
		} catch (err) {
			this.container.logger.warn(
				`[verification] Could not give the unverified role to ${member.id} in ${member.guild.id}:`,
				err,
			);
		}
	}
}
