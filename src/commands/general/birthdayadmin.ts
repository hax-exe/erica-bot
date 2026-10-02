import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { eq } from 'drizzle-orm';
import { errorReply, successReply, warningReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

/**
 * Staff birthday announcement settings. Split out of `/birthday config` so the
 * whole command can carry a ManageGuild default permission (Discord can't hide
 * individual subcommands). The runtime ManageGuild check stays as defence in
 * depth — server admins can override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'birthdayadmin',
	description: 'Configure birthday announcements (Staff only).',
	subcommands: [
		{ name: 'setchannel', chatInputRun: 'chatInputSetChannel' },
		{ name: 'setrole', chatInputRun: 'chatInputSetRole' },
		{ name: 'setmessage', chatInputRun: 'chatInputSetMessage' },
		{ name: 'toggle', chatInputRun: 'chatInputToggle' },
	],
})
export class BirthdayAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('birthdayadmin')
				.setDescription('Configure birthday announcements (Staff only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('setchannel')
						.setDescription('Set the birthday announcement channel (omit to clear).')
						.addChannelOption((o) =>
							o
								.setName('channel')
								.setDescription('Channel for birthday messages.')
								.addChannelTypes(ChannelType.GuildText)
								.setRequired(false),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setrole')
						.setDescription('Set a role to assign on birthdays for 24h (omit to clear).')
						.addRoleOption((o) => o.setName('role').setDescription('Birthday role.').setRequired(false)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('setmessage')
						.setDescription('Set a custom birthday message. Supports {user}, {username}, {server}. Omit to reset.')
						.addStringOption((o) =>
							o.setName('text').setDescription('Birthday message.').setMaxLength(500).setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('toggle').setDescription('Enable or disable birthday announcements.')),
		);
	}

	/** Deferred + in guild + ManageGuild. Returns the guild ID, or null after replying with an error. */
	private async guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<string | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			await interaction.editReply(errorReply('Server only.'));
			return null;
		}
		if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.editReply(errorReply('You need Manage Server to do this.'));
			return null;
		}
		return interaction.guildId;
	}

	// ── /birthdayadmin setchannel ──────────────────────────────────────────────

	public async chatInputSetChannel(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const channel = interaction.options.getChannel('channel');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId, channelId: channel?.id ?? null })
			.onDuplicateKeyUpdate({ set: { channelId: channel?.id ?? null } });

		return interaction.editReply(
			channel ? successReply(`Birthday channel set to <#${channel.id}>.`) : successReply('Birthday channel cleared.'),
		);
	}

	// ── /birthdayadmin setrole ─────────────────────────────────────────────────

	public async chatInputSetRole(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const role = interaction.options.getRole('role');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId, roleId: role?.id ?? null })
			.onDuplicateKeyUpdate({ set: { roleId: role?.id ?? null } });

		return interaction.editReply(
			role ? successReply(`Birthday role set to <@&${role.id}>.`) : successReply('Birthday role cleared.'),
		);
	}

	// ── /birthdayadmin setmessage ──────────────────────────────────────────────

	public async chatInputSetMessage(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const text = interaction.options.getString('text');
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId, message: text ?? null })
			.onDuplicateKeyUpdate({ set: { message: text ?? null } });

		return interaction.editReply(
			text ? successReply('Birthday message updated.') : successReply('Birthday message reset to default.'),
		);
	}

	// ── /birthdayadmin toggle ──────────────────────────────────────────────────

	public async chatInputToggle(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const settings = await db
			.select()
			.from(schema.birthdaySettings)
			.where(eq(schema.birthdaySettings.guildId, guildId))
			.limit(1)
			.then((r) => r[0] ?? null);

		if (!settings?.channelId) {
			return interaction.editReply(warningReply('Set a channel first with `/birthdayadmin setchannel`.'));
		}

		const newEnabled = !settings.enabled;
		await db
			.insert(schema.birthdaySettings)
			.values({ guildId, enabled: newEnabled })
			.onDuplicateKeyUpdate({ set: { enabled: newEnabled } });

		return interaction.editReply(successReply(`Birthday announcements ${newEnabled ? 'enabled ✅' : 'disabled ❌'}.`));
	}
}
