import type { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../../lib/components.js';
import { db, schema } from '../../../lib/database.js';

async function getSettings(guildId: string) {
	return db.query.antiRaidSettings.findFirst({ where: eq(schema.antiRaidSettings.guildId, guildId) });
}

export class AntiRaidHandler {
	public async runSetup(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const threshold = interaction.options.getInteger('threshold') ?? undefined;
		const windowSeconds = interaction.options.getInteger('window') ?? undefined;
		const action = interaction.options.getString('action') ?? undefined;
		const autoUnlockMinutes = interaction.options.getInteger('auto_unlock') ?? undefined;
		const logChannel = interaction.options.getChannel('log_channel');
		const alertRole = interaction.options.getRole('alert_role');

		const current = await getSettings(interaction.guildId);

		await db
			.insert(schema.antiRaidSettings)
			.values({
				guildId: interaction.guildId,
				enabled: current?.enabled ?? false,
				joinThreshold: threshold ?? current?.joinThreshold ?? 10,
				windowSeconds: windowSeconds ?? current?.windowSeconds ?? 10,
				action: (action ?? current?.action ?? 'lock') as 'lock' | 'kick' | 'ban',
				logChannelId: logChannel ? logChannel.id : (current?.logChannelId ?? null),
				alertRoleId: alertRole ? alertRole.id : (current?.alertRoleId ?? null),
				autoUnlockMinutes: autoUnlockMinutes ?? current?.autoUnlockMinutes ?? 10,
			})
			.onDuplicateKeyUpdate({
				set: {
					joinThreshold: threshold ?? current?.joinThreshold ?? 10,
					windowSeconds: windowSeconds ?? current?.windowSeconds ?? 10,
					action: (action ?? current?.action ?? 'lock') as 'lock' | 'kick' | 'ban',
					logChannelId: logChannel ? logChannel.id : (current?.logChannelId ?? null),
					alertRoleId: alertRole ? alertRole.id : (current?.alertRoleId ?? null),
					autoUnlockMinutes: autoUnlockMinutes ?? current?.autoUnlockMinutes ?? 10,
				},
			});

		return interaction.editReply(successReply('Anti-raid settings saved. Use `/antiraid toggle` to enable.'));
	}

	public async runToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const current = await getSettings(interaction.guildId);
		const newState = !(current?.enabled ?? false);

		await db
			.insert(schema.antiRaidSettings)
			.values({ guildId: interaction.guildId, enabled: newState })
			.onDuplicateKeyUpdate({
				set: { enabled: newState },
			});

		return interaction.editReply(successReply(`Anti-raid protection **${newState ? 'enabled' : 'disabled'}**.`));
	}

	public async runView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const cfg = await getSettings(interaction.guildId);

		const lines = [
			`**Status** ${cfg?.enabled ? 'Enabled' : 'Disabled'}`,
			`**Threshold** ${cfg?.joinThreshold ?? 10} joins in ${cfg?.windowSeconds ?? 10}s`,
			`**Action** ${cfg?.action ?? 'lock'}`,
			`**Auto-unlock** ${cfg?.autoUnlockMinutes ?? 10} min${(cfg?.autoUnlockMinutes ?? 10) === 0 ? ' (manual)' : ''}`,
			`**Log channel** ${cfg?.logChannelId ? `<#${cfg.logChannelId}>` : '*(not set)*'}`,
			`**Alert role** ${cfg?.alertRoleId ? `<@&${cfg.alertRoleId}>` : '*(not set)*'}`,
		];

		const c = makeContainer({ color: Colors.Warning, header: 'Anti-Raid Settings' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

		// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	public async runLock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const { manualLock } = await import('../../../listeners/moderation/antiRaid.js');
		const success = await manualLock(interaction.guild, interaction.user.id);

		if (!success) {
			return interaction.editReply(errorReply('Server is already locked in raid mode.'));
		}

		return interaction.editReply(
			successReply('Server verification level set to **Very High** (manual raid lock active).'),
		);
	}

	public async runUnlock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const { manualUnlock } = await import('../../../listeners/moderation/antiRaid.js');
		const success = await manualUnlock(interaction.guild, interaction.user.username);

		if (!success) {
			return interaction.editReply(errorReply('Server is not currently locked in raid mode.'));
		}

		return interaction.editReply(successReply('Server raid lock has been lifted and verification level restored.'));
	}
}
