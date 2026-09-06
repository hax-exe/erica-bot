import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';
import { isModuleEnabled } from '../../../lib/ModuleUtil.js';

export class CountingHandler {
	public async chatInputSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const channel = interaction.options.getChannel('channel', true);
		const resetOnFail = interaction.options.getBoolean('reset_on_fail') ?? true;

		await db
			.insert(schema.countingSettings)
			.values({
				guildId: interaction.guildId,
				channelId: channel.id,
				resetOnFail,
				enabled: true,
				currentCount: 0,
				lastUserId: null,
				highScore: 0,
			})
			.onDuplicateKeyUpdate({
				set: {
					channelId: channel.id,
					resetOnFail,
					enabled: true,
				},
			});

		return interaction.editReply(
			successReply(`Counting channel set to <#${channel.id}>. Reset on fail: **${resetOnFail ? 'Yes' : 'No'}**.`),
		);
	}

	public async chatInputDisable(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		await db
			.insert(schema.countingSettings)
			.values({
				guildId: interaction.guildId,
				enabled: false,
			})
			.onDuplicateKeyUpdate({
				set: { enabled: false },
			});

		return interaction.editReply(successReply('Counting channel disabled.'));
	}

	public async chatInputReset(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const settings = await db.query.countingSettings.findFirst({
			where: eq(schema.countingSettings.guildId, interaction.guildId),
		});

		if (!settings) return interaction.editReply(errorReply('Counting is not configured. Use `/counting setup` first.'));

		await db
			.insert(schema.countingSettings)
			.values({
				guildId: interaction.guildId,
				currentCount: 0,
				lastUserId: null,
			})
			.onDuplicateKeyUpdate({
				set: { currentCount: 0, lastUserId: null },
			});

		return interaction.editReply(successReply('Count reset to **0**.'));
	}

	public async chatInputStatus(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const settings = await db.query.countingSettings.findFirst({
			where: eq(schema.countingSettings.guildId, interaction.guildId),
		});

		if (!settings) return interaction.editReply(errorReply('Counting is not configured. Use `/counting setup` first.'));

		const container = makeContainer({ color: settings.enabled ? Colors.Success : Colors.Neutral });
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent('### Counting Channel Status'));
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					`**Status** ${settings.enabled ? 'Enabled' : 'Disabled'}`,
					`**Channel** ${settings.channelId ? `<#${settings.channelId}>` : 'Not set'}`,
					`**Current Count** ${settings.currentCount}`,
					`**High Score** ${settings.highScore}`,
					`**Reset on Fail** ${settings.resetOnFail ? 'Yes' : 'No'}`,
					settings.lastUserId ? `**Last Counter** <@${settings.lastUserId}>` : '**Last Counter** None',
				].join('\n'),
			),
		);

		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [container], flags: CV2_FLAG as any });
	}
}
