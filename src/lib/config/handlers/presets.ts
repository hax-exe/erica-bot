import type { Command } from '@sapphire/framework';
import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { Colors, errorReply, logContainer, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

export class PresetsHandler {
	public async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.inCachedGuild()) return interaction.respond([]);
		const focused = interaction.options.getFocused();

		const presets = await db.query.moderationPresets.findMany({
			where: eq(schema.moderationPresets.guildId, interaction.guild.id),
		});

		const filtered = presets.filter((p) => p.reason.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);

		return interaction.respond(
			filtered.map((p) => ({
				name: `ID ${p.id}: ${p.reason.slice(0, 80)}`,
				value: p.id,
			})),
		);
	}

	public async runAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) return;

		const reason = interaction.options.getString('reason', true);

		const current = await db.query.moderationPresets.findMany({
			where: eq(schema.moderationPresets.guildId, interaction.guild.id),
		});

		if (current.length >= 25) {
			return interaction.editReply(errorReply('You can only have up to 25 presets.'));
		}

		await db.insert(schema.moderationPresets).values({
			guildId: interaction.guild.id,
			reason,
		});

		const { sendModLog } = await import('../../../lib/LoggingUtil.js');
		await sendModLog(
			interaction.guild,
			logContainer({
				title: 'Moderation Preset Added',
				color: Colors.Success,
				fields: [
					{ name: 'Preset Reason', value: reason },
					{ name: 'Moderator', value: `${interaction.user.username} (${interaction.user.id})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(successReply(`Added moderation preset: \`${reason}\``));
	}

	public async runRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) return;

		const id = interaction.options.getInteger('id', true);

		const [existing] = await db
			.select()
			.from(schema.moderationPresets)
			.where(and(eq(schema.moderationPresets.id, id), eq(schema.moderationPresets.guildId, interaction.guild.id)))
			.limit(1);

		if (!existing) {
			return interaction.editReply(errorReply('Preset not found.'));
		}

		await db
			.delete(schema.moderationPresets)
			.where(and(eq(schema.moderationPresets.id, id), eq(schema.moderationPresets.guildId, interaction.guild.id)));

		const { sendModLog } = await import('../../../lib/LoggingUtil.js');
		await sendModLog(
			interaction.guild,
			logContainer({
				title: 'Moderation Preset Removed',
				color: Colors.Error,
				fields: [
					{ name: 'ID', value: `${existing.id}` },
					{ name: 'Preset Reason', value: existing.reason },
					{ name: 'Moderator', value: `${interaction.user.username} (${interaction.user.id})` },
				],
				timestamp: true,
			}),
		).catch(() => null);

		return interaction.editReply(successReply(`Removed preset: \`${existing.reason}\``));
	}

	public async runList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) return;

		const current = await db.query.moderationPresets.findMany({
			where: eq(schema.moderationPresets.guildId, interaction.guild.id),
		});

		if (!current.length) {
			return interaction.editReply(errorReply('There are no moderation presets configured for this server.'));
		}

		const list = current.map((p) => `**ID ${p.id}:** ${p.reason}`).join('\n');
		return interaction.editReply({ content: `**Moderation Presets:**\n${list}` });
	}
}
