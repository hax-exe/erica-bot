import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember } from 'discord.js';
import { eq } from 'drizzle-orm';
import { CV2_FLAG } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { buildWelcomeContainer, getWelcomeSettings, resolvePlaceholders } from '../../lib/WelcomeUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'welcomeOnJoin',
	event: Events.GuildMemberAdd,
})
export class WelcomeListener extends Listener<typeof Events.GuildMemberAdd> {
	public override async run(member: GuildMember) {
		const settings = await getWelcomeSettings(member.guild.id);

		// ── Legacy single autorole ────────────────────────────────────────────────
		if (settings?.autoroleId) {
			await member.roles.add(settings.autoroleId).catch((err: unknown) => {
				this.container.logger.error('[welcomer] Failed to assign autorole:', err);
			});
		}

		// ── Auto-roles array ──────────────────────────────────────────────────────
		const autoRoles = await db.query.autoRoles.findMany({
			where: eq(schema.autoRoles.guildId, member.guild.id),
		});
		for (const ar of autoRoles) {
			await member.roles.add(ar.roleId).catch((err: unknown) => {
				this.container.logger.error(
					`[welcomer] Failed to assign autorole ${ar.roleId} to ${member.id} in ${member.guild.id}:`,
					err,
				);
			});
		}

		// ── Welcome channel message ───────────────────────────────────────────────
		if (settings?.enabled && settings.channelId && (await isModuleEnabled(member.guild.id, 'welcomer'))) {
			const channel = member.guild.channels.cache.get(settings.channelId);
			if (channel?.isTextBased()) {
				const container = await buildWelcomeContainer(settings, member);
				await (channel.send as (options: unknown) => Promise<unknown>)({
					components: [container],
					flags: CV2_FLAG,
				}).catch((err: unknown) => {
					this.container.logger.error('[welcomer] Failed to send welcome message:', err);
				});
			}
		}

		// ── Welcome DM ────────────────────────────────────────────────────────────
		if (settings?.dmEnabled && settings.dmMessage) {
			const dmText = resolvePlaceholders(settings.dmMessage, member);
			await member.send({ content: dmText }).catch(() => null);
		}
	}
}
