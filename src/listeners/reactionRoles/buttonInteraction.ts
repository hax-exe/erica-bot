import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'reactionRoleButtonInteraction',
	event: Events.InteractionCreate,
})
export class ReactionRoleButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('rr_btn:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// customId: rr_btn:<panelId>:<roleId>
		const parts = interaction.customId.split(':');
		if (parts.length < 3) return interaction.editReply(errorReply('Malformed button ID.'));
		const roleId = parts.slice(2).join(':');

		// Verify the role is on this panel
		const panelId = parseInt(parts[1], 10);
		const panelRoles = await db.select().from(schema.rrPanelRoles).where(eq(schema.rrPanelRoles.panelId, panelId));
		const entry = panelRoles.find((r) => r.roleId === roleId);

		if (!entry) return interaction.editReply(errorReply('This role is no longer available on this panel.'));

		const member = interaction.member;
		const hasRole = member.roles.cache.has(roleId);

		if (hasRole) {
			await member.roles.remove(roleId).catch(() => null);
			return interaction.editReply(warningReply(`Removed <@&${roleId}>.`));
		}

		await member.roles.add(roleId).catch(() => null);
		return interaction.editReply(successReply(`Added <@&${roleId}>.`));
	}
}
