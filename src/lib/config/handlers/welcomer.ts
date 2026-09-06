import type { Subcommand } from '@sapphire/plugin-subcommands';
import { GuildMember, MessageFlags } from 'discord.js';
import { CV2_FLAG, errorReply, successReply, warningReply } from '../../../lib/components.js';
import {
	buildLeaveContainer,
	buildWelcomeContainer,
	getLeaveSettings,
	getWelcomeSettings,
	upsertLeaveSettings,
	upsertWelcomeSettings,
} from '../../../lib/WelcomeUtil.js';

/** Parse a 6-digit hex color string (#RRGGBB or RRGGBB) → integer, or null if invalid. */
function parseHexColor(hex: string): number | null {
	const clean = hex.replace(/^#/, '');
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
	return parseInt(clean, 16);
}

export class WelcomerHandler {
	// ── /welcomer welcome handlers ─────────────────────────────────────────────

	public async chatInputWelcomeSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel = interaction.options.getChannel('channel');
		await upsertWelcomeSettings(interaction.guildId, { channelId: channel?.id ?? null });
		return interaction.editReply(
			channel ? successReply(`Welcome channel set to <#${channel.id}>.`) : successReply('Welcome channel cleared.'),
		);
	}

	public async chatInputWelcomeSetMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertWelcomeSettings(interaction.guildId, { message: text ?? null });
		return interaction.editReply(
			text ? successReply('Welcome message updated.') : successReply('Welcome message reset to default.'),
		);
	}

	public async chatInputWelcomeSetTitle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertWelcomeSettings(interaction.guildId, { title: text ?? null });
		return interaction.editReply(
			text ? successReply('Welcome title updated.') : successReply('Welcome title reset to default.'),
		);
	}

	public async chatInputWelcomeSetColor(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const hex = interaction.options.getString('hex');
		if (hex) {
			const color = parseHexColor(hex);
			if (color === null) {
				return interaction.editReply(errorReply('Invalid hex color. Use format `#RRGGBB` or `RRGGBB`.'));
			}
			await upsertWelcomeSettings(interaction.guildId, { color });
			return interaction.editReply(successReply(`Welcome color set to \`#${hex.replace('#', '').toUpperCase()}\`.`));
		}
		await upsertWelcomeSettings(interaction.guildId, { color: null });
		return interaction.editReply(successReply('Welcome color reset to default.'));
	}

	public async chatInputWelcomeSetFooter(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertWelcomeSettings(interaction.guildId, { footer: text ?? null });
		return interaction.editReply(text ? successReply('Welcome footer set.') : successReply('Welcome footer cleared.'));
	}

	public async chatInputWelcomeToggleAvatar(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getWelcomeSettings(interaction.guildId);
		const current = settings?.showAvatar ?? true;
		await upsertWelcomeSettings(interaction.guildId, { showAvatar: !current });
		return interaction.editReply(
			successReply(`Avatar thumbnail ${!current ? 'enabled' : 'disabled'} for welcome messages.`),
		);
	}

	public async chatInputWelcomeAutorole(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const role = interaction.options.getRole('role');
		await upsertWelcomeSettings(interaction.guildId, { autoroleId: role?.id ?? null });
		return interaction.editReply(
			role
				? successReply(`Autorole set to <@&${role.id}>. New members will receive this role on join.`)
				: successReply('Autorole cleared.'),
		);
	}

	public async chatInputWelcomeToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getWelcomeSettings(interaction.guildId);
		if (!settings?.channelId) {
			return interaction.editReply(warningReply('Set a welcome channel first with `/welcomer welcome setchannel`.'));
		}
		const newEnabled = !settings.enabled;
		await upsertWelcomeSettings(interaction.guildId, { enabled: newEnabled });
		return interaction.editReply(successReply(`Welcome messages ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}

	public async chatInputWelcomePreview(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
		if (!member) return interaction.editReply(errorReply('Could not resolve your member data.'));

		const settings = (await getWelcomeSettings(interaction.guildId)) ?? {
			guildId: interaction.guildId,
			enabled: false,
			channelId: null,
			message: null,
			title: null,
			color: null,
			footer: null,
			showAvatar: true,
			autoroleId: null,
			dmEnabled: false,
			dmMessage: null,
		};

		const container = await buildWelcomeContainer(settings, member);
		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [container], flags: CV2_FLAG as any });
	}

	// ── /welcomer leave handlers ───────────────────────────────────────────────

	public async chatInputLeaveSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const channel = interaction.options.getChannel('channel');
		await upsertLeaveSettings(interaction.guildId, { channelId: channel?.id ?? null });
		return interaction.editReply(
			channel ? successReply(`Leave channel set to <#${channel.id}>.`) : successReply('Leave channel cleared.'),
		);
	}

	public async chatInputLeaveSetMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertLeaveSettings(interaction.guildId, { message: text ?? null });
		return interaction.editReply(
			text ? successReply('Leave message updated.') : successReply('Leave message reset to default.'),
		);
	}

	public async chatInputLeaveSetTitle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertLeaveSettings(interaction.guildId, { title: text ?? null });
		return interaction.editReply(
			text ? successReply('Leave title updated.') : successReply('Leave title reset to default.'),
		);
	}

	public async chatInputLeaveSetColor(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const hex = interaction.options.getString('hex');
		if (hex) {
			const color = parseHexColor(hex);
			if (color === null) {
				return interaction.editReply(errorReply('Invalid hex color. Use format `#RRGGBB` or `RRGGBB`.'));
			}
			await upsertLeaveSettings(interaction.guildId, { color });
			return interaction.editReply(successReply(`Leave color set to \`#${hex.replace('#', '').toUpperCase()}\`.`));
		}
		await upsertLeaveSettings(interaction.guildId, { color: null });
		return interaction.editReply(successReply('Leave color reset to default.'));
	}

	public async chatInputLeaveSetFooter(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertLeaveSettings(interaction.guildId, { footer: text ?? null });
		return interaction.editReply(text ? successReply('Leave footer set.') : successReply('Leave footer cleared.'));
	}

	public async chatInputLeaveToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getLeaveSettings(interaction.guildId);
		if (!settings?.channelId) {
			return interaction.editReply(warningReply('Set a leave channel first with `/welcomer leave setchannel`.'));
		}
		const newEnabled = !settings.enabled;
		await upsertLeaveSettings(interaction.guildId, { enabled: newEnabled });
		return interaction.editReply(successReply(`Leave messages ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}

	public async chatInputLeavePreview(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
		if (!member) return interaction.editReply(errorReply('Could not resolve your member data.'));

		const settings = (await getLeaveSettings(interaction.guildId)) ?? {
			guildId: interaction.guildId,
			enabled: false,
			channelId: null,
			message: null,
			title: null,
			color: null,
			footer: null,
		};

		const container = buildLeaveContainer(settings, member);
		// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
		return interaction.editReply({ components: [container], flags: CV2_FLAG as any });
	}

	// ── /welcomer dm handlers ──────────────────────────────────────────────────

	public async chatInputDmSetMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const text = interaction.options.getString('text');
		await upsertWelcomeSettings(interaction.guildId, { dmMessage: text ?? null });
		return interaction.editReply(
			text ? successReply('Welcome DM message set.') : successReply('Welcome DM message cleared.'),
		);
	}

	public async chatInputDmToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const settings = await getWelcomeSettings(interaction.guildId);
		if (!settings?.dmMessage) {
			return interaction.editReply(warningReply('Set a DM message first with `/welcomer dm setmessage`.'));
		}
		const newEnabled = !settings.dmEnabled;
		await upsertWelcomeSettings(interaction.guildId, { dmEnabled: newEnabled });
		return interaction.editReply(successReply(`Welcome DM ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}
}
