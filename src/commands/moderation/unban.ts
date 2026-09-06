import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply } from '../../lib/components.js';
import { createInfraction, dispatchModLog } from '../../lib/ModerationUtil.js';

@ApplyOptions<Command.Options>({
	name: 'unban',
	description: 'Revoke a ban from a user.',
	preconditions: ['Moderation'],
})
export class UnbanCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('unban')
				.setDescription('Revoke a ban from a user.')
				.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
				.addStringOption((o) =>
					o.setName('user').setDescription('The user ID or username to unban.').setRequired(true).setAutocomplete(true),
				)
				.addStringOption((o) => o.setName('reason').setDescription('Reason for the unban.').setRequired(false)),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		if (!interaction.inCachedGuild()) return interaction.respond([]);
		const focused = interaction.options.getFocused();

		const bans = await interaction.guild.bans.fetch().catch(() => null);
		if (!bans) return interaction.respond([]);

		const filtered = Array.from(bans.values())
			.filter((b) => b.user.id.includes(focused) || b.user.username.toLowerCase().includes(focused.toLowerCase()))
			.slice(0, 25);

		return interaction.respond(
			filtered.map((b) => ({
				name: `${b.user.username} (${b.user.id})`,
				value: b.user.id,
			})),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.BanMembers)) {
			return interaction.editReply(errorReply('You do not have permission to unban members.'));
		}

		const query = interaction.options.getString('user', true).trim();
		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		let ban: import('discord.js').GuildBan | null = null;

		if (/^\d{17,20}$/.test(query)) {
			ban = await guild.bans.fetch(query).catch(() => null);
			if (!ban) {
				return interaction.editReply(errorReply('That user is not banned from this server.'));
			}
		} else {
			const bans = await guild.bans.fetch().catch(() => null);
			if (!bans) {
				return interaction.editReply(errorReply('Failed to fetch the ban list.'));
			}
			const queryLower = query.toLowerCase();
			ban = bans.find((b) => b.user.username.toLowerCase() === queryLower) ?? null;
			if (!ban) {
				return interaction.editReply(
					errorReply(`No banned user found matching \`${query}\`. Try using their user ID instead.`),
				);
			}
		}

		try {
			const dm = makeContainer({ color: Colors.Success, header: `You have been unbanned from ${guild.name}` });
			dm.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`You are now allowed to rejoin the server.\n**Reason** ${reason}`),
			);
			await ban.user.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await guild.bans.remove(ban.user.id, `[${interaction.user.username}] ${reason}`);

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: ban.user.id,
				moderatorId: interaction.user.id,
				type: 'unban',
				reason,
			});

			await dispatchModLog({
				guild,
				targetUser: ban.user,
				moderator: interaction.user,
				type: 'unban',
				reason,
				caseId: infraction.caseId,
			});

			return interaction.editReply(
				successReply(`**${ban.user.username}** has been unbanned. Case \`${infraction.caseId}\`.`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to unban the user.'));
		}
	}
}
