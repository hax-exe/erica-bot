import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits, type PermissionsBitField } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { addXpAdmin, levelFromTotalXp, resetXp, setXp } from '../../lib/LevelingUtil.js';

function hasModPerms(perms: Readonly<PermissionsBitField> | null): boolean {
	if (!perms) return false;
	if (perms.has(PermissionFlagsBits.Administrator)) return true;
	return perms.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Staff XP tools. Split out of `/level` so the whole command can carry a
 * ManageGuild default permission (Discord can't hide individual subcommands).
 * The runtime moderator check stays as defence in depth — server admins can
 * override command visibility in Integrations settings.
 */
@ApplyOptions<Subcommand.Options>({
	name: 'leveladmin',
	description: 'Manage member XP (Manage Server only).',
	subcommands: [
		{ name: 'set', chatInputRun: 'chatInputSet' },
		{ name: 'add', chatInputRun: 'chatInputAdd' },
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'reset', chatInputRun: 'chatInputReset' },
	],
})
export class LevelAdminCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('leveladmin')
				.setDescription('Manage member XP (Manage Server only).')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
				.addSubcommand((sub) =>
					sub
						.setName('set')
						.setDescription("Set a member's total XP.")
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('Total XP to set').setMinValue(0).setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('add')
						.setDescription('Add XP to a member.')
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) => o.setName('amount').setDescription('XP to add').setMinValue(1).setRequired(true)),
				)
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove XP from a member.')
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('XP to remove').setMinValue(1).setRequired(true),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('reset')
						.setDescription("Reset a member's XP to 0.")
						.addUserOption((o) => o.setName('user').setDescription('Target member').setRequired(true)),
				),
		);
	}

	/** Deferred + in guild + moderator. Returns the guild ID, or null after replying with an error. */
	private async guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<string | null> {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			await interaction.editReply(errorReply('This command can only be used in a server.'));
			return null;
		}
		if (!hasModPerms(interaction.memberPermissions)) {
			await interaction.editReply(errorReply('You do not have permission to manage member XP.'));
			return null;
		}
		return interaction.guildId;
	}

	public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		await setXp(guildId, user.id, amount);
		const { level } = levelFromTotalXp(amount);
		return interaction.editReply(
			successReply(`Set **${user.tag}**'s XP to **${amount.toLocaleString()}** (Level ${level}).`),
		);
	}

	public async chatInputAdd(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		const result = await addXpAdmin(guildId, user.id, amount);
		return interaction.editReply(
			successReply(
				`Added **${amount.toLocaleString()} XP** to **${user.tag}** → ${result.totalXp.toLocaleString()} XP (Level ${result.level}).`,
			),
		);
	}

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const user = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		const result = await addXpAdmin(guildId, user.id, -amount);
		return interaction.editReply(
			successReply(
				`Removed **${amount.toLocaleString()} XP** from **${user.tag}** → ${result.totalXp.toLocaleString()} XP (Level ${result.level}).`,
			),
		);
	}

	public async chatInputReset(interaction: Subcommand.ChatInputCommandInteraction) {
		const guildId = await this.guard(interaction);
		if (!guildId) return;

		const user = interaction.options.getUser('user', true);
		await resetXp(guildId, user.id);
		return interaction.editReply(successReply(`Reset **${user.tag}**'s XP.`));
	}
}
