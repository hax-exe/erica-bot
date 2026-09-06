import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type PartialGuildMember, userMention } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'guildMemberUpdateLogging',
	event: Events.GuildMemberUpdate,
})
export class GuildMemberUpdateListener extends Listener<typeof Events.GuildMemberUpdate> {
	public override async run(oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) {
		if (newMember.user.bot) return;
		if (!(await isModuleEnabled(newMember.guild.id, 'logging'))) return;

		const userValue = `${formatUser(newMember.id, newMember.user.username)}`;

		// ── Nitro boost status ────────────────────────────────────────────────────
		const wasBoosting = oldMember.premiumSinceTimestamp != null;
		const isBoosting = newMember.premiumSinceTimestamp != null;

		if (!wasBoosting && isBoosting) {
			await sendLog(
				newMember.guild,
				logContainer({
					title: 'Member Started Boosting',
					color: 0xff73fa,
					fields: [{ name: 'User', value: userValue }],
					timestamp: true,
				}),
			).catch(() => null);
		} else if (wasBoosting && !isBoosting) {
			await sendLog(
				newMember.guild,
				logContainer({
					title: 'Member Stopped Boosting',
					color: Colors.Neutral,
					fields: [{ name: 'User', value: userValue }],
					timestamp: true,
				}),
			).catch(() => null);
		}

		// ── Server profile avatar ─────────────────────────────────────────────────
		const oldAvatar = (oldMember as GuildMember).avatar ?? null;
		const newAvatar = newMember.avatar ?? null;
		if (oldAvatar !== newAvatar) {
			const newAvatarUrl = newMember.avatarURL({ size: 256, extension: 'png' });
			const oldAvatarUrl =
				oldAvatar && oldMember.guild
					? `https://cdn.discordapp.com/guilds/${newMember.guild.id}/users/${newMember.id}/avatars/${oldAvatar}.png?size=256`
					: null;

			await sendLog(
				newMember.guild,
				logContainer({
					title: 'Server Avatar Updated',
					color: Colors.Neutral,
					fields: [
						{ name: 'User', value: userValue },
						{ name: 'Old Avatar', value: oldAvatarUrl ? `[View](${oldAvatarUrl})` : '*(none)*' },
						{ name: 'New Avatar', value: newAvatarUrl ? `[View](${newAvatarUrl})` : '*(removed)*' },
					],
					thumbnailUrl: newAvatarUrl ?? undefined,
					timestamp: true,
				}),
			).catch(() => null);
		}

		// ── Pending membership screening ─────────────────────────────────────────
		if (oldMember.pending && !newMember.pending) {
			await sendLog(
				newMember.guild,
				logContainer({
					title: 'Member Passed Membership Screening',
					color: Colors.Success,
					fields: [{ name: 'User', value: userValue }],
					timestamp: true,
				}),
			).catch(() => null);
		}
	}
}
