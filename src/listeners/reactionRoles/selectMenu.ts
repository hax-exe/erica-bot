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
		const failed: string[] = [];
		const ok = () => true;
		const notOk = () => false;

		for (const roleId of panelRoleIds) {
			const hasRole = member.roles.cache.has(roleId);
			const shouldHave = selectedRoleIds.has(roleId);

			if (shouldHave && !hasRole) {
				if (await member.roles.add(roleId).then(ok, notOk)) added.push(roleId);
				else failed.push(roleId);
			} else if (!shouldHave && hasRole) {
				if (await member.roles.remove(roleId).then(ok, notOk)) removed.push(roleId);
				else failed.push(roleId);
			}
		}

		if (!added.length && !removed.length && !failed.length) {
			return interaction.followUp(warningReply('No changes — you already have the selected roles.') as any);
		}

		const mentions = (ids: string[]) => ids.map((id) => `<@&${id}>`).join(', ');
		const parts: string[] = [];
		if (added.length) parts.push(`**Added:** ${mentions(added)}`);
		if (removed.length) parts.push(`**Removed:** ${mentions(removed)}`);
		if (failed.length) {
			parts.push(
				`I couldn't update ${mentions(failed)} — my role may be below ${failed.length === 1 ? 'it' : 'them'}, or I'm missing Manage Roles.`,
			);
		}
		const reply = !failed.length ? successReply : added.length || removed.length ? warningReply : errorReply;
		return interaction.followUp(reply(parts.join('\n'), true) as any);
	}
}
