import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { and, eq, sql } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

export class AutoroleHandler {
	public async runAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);
		if (role.managed) return interaction.editReply(errorReply('Cannot auto-assign managed/integration roles.'));
		if (role.id === interaction.guildId) return interaction.editReply(errorReply('Cannot auto-assign @everyone.'));

		const existing = await db.query.autoRoles.findMany({
			where: eq(schema.autoRoles.guildId, interaction.guildId),
		});
		if (existing.length >= 10) return interaction.editReply(errorReply('Maximum of 10 auto-roles per server.'));

		await db
			.insert(schema.autoRoles)
			.values({ guildId: interaction.guildId, roleId: role.id })
			.onDuplicateKeyUpdate({ set: { id: sql`${schema.autoRoles.id}` } });

		return interaction.editReply(successReply(`<@&${role.id}> will now be assigned to all new members.`));
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role', true);

		const result = await db
			.delete(schema.autoRoles)
			.where(and(eq(schema.autoRoles.guildId, interaction.guildId), eq(schema.autoRoles.roleId, role.id)));
		const affected = Number((result as any)[0]?.affectedRows ?? 0);

		if (affected === 0) return interaction.editReply(errorReply(`<@&${role.id}> is not in the auto-role list.`));
		return interaction.editReply(successReply(`Removed <@&${role.id}> from auto-roles.`));
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const rows = await db.query.autoRoles.findMany({
			where: eq(schema.autoRoles.guildId, interaction.guildId),
		});

		if (!rows.length)
			return interaction.editReply(errorReply('No auto-roles configured. Use `/autorole add` to add one.'));

		const c = makeContainer({ color: Colors.Info, header: 'Auto Roles' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows.map((r) => `• <@&${r.roleId}>`).join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${rows.length}/10 roles • Assigned on member join`),
		);

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
