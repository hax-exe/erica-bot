import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction } from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'reactionRoleSelectMenu',
	event: Events.InteractionCreate,
})
export class ReactionRoleSelectMenuListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isStringSelectMenu()) return;
		if (!interaction.customId.startsWith('rr:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		await interaction.deferUpdate();

		const panelId = parseInt(interaction.customId.slice(3), 10);

		// Fetch all roles on this panel
		const panelRoles = await db.select().from(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, panelId));

		if (!panelRoles.length) {
			return interaction.followUp(errorReply('This panel has no roles configured.') as any);
		}

		const panelRoleIds = panelRoles.map((r) => r.roleId);
		const selectedRoleIds = new Set(interaction.values);

		const member = interaction.member;
		const added: string[] = [];
		const removed: string[] = [];

		for (const roleId of panelRoleIds) {
			const hasRole = member.roles.cache.has(roleId);
			const shouldHave = selectedRoleIds.has(roleId);

			if (shouldHave && !hasRole) {
				await member.roles.add(roleId).catch(() => null);
				added.push(roleId);
			} else if (!shouldHave && hasRole) {
				await member.roles.remove(roleId).catch(() => null);
				removed.push(roleId);
			}
		}

		if (!added.length && !removed.length) {
			return interaction.followUp(warningReply('No changes — you already have the selected roles.') as any);
		}

		const parts: string[] = [];
		if (added.length) parts.push(`**Added:** ${added.map((id) => `<@&${id}>`).join(', ')}`);
		if (removed.length) parts.push(`**Removed:** ${removed.map((id) => `<@&${id}>`).join(', ')}`);
		return interaction.followUp(successReply(parts.join('\n'), true) as any);
	}
}
