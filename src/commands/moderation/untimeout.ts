import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, successReply } from '../../lib/components.js';
import {
	checkHierarchy,
	createInfraction,
	dispatchModLog,
	handleReasonAutocomplete,
} from '../../lib/ModerationUtil.js';

@ApplyOptions<Command.Options>({
	name: 'untimeout',
	description: 'Remove timeout from a member.',
	preconditions: ['Moderation'],
})
export class UntimeoutCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('untimeout')
				.setDescription('Remove timeout from a member.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
				.addUserOption((o) => o.setName('user').setDescription('The member to remove timeout from.').setRequired(true))
				.addStringOption((o) =>
					o
						.setName('reason')
						.setDescription('Reason for removing the timeout.')
						.setRequired(false)
						.setAutocomplete(true),
				),
		);
	}

	public override async autocompleteRun(interaction: Command.AutocompleteInteraction) {
		return handleReasonAutocomplete(interaction);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
			return interaction.editReply(errorReply('You do not have permission to moderate members.'));
		}

		const target = interaction.options.getMember('user');
		if (!target) {
			return interaction.editReply(errorReply('That user is not in this server.'));
		}

		const reason = interaction.options.getString('reason') ?? 'No reason provided';
		const guild = interaction.guild;

		if (!target.moderatable) {
			return interaction.editReply(errorReply('I cannot modify this user (missing permissions or higher role).'));
		}

		const h = checkHierarchy(interaction.member, target);
		if (!h.ok) return interaction.editReply(errorReply(h.reason));

		const isTimedOut =
			target.communicationDisabledUntilTimestamp && target.communicationDisabledUntilTimestamp > Date.now();
		if (!isTimedOut) {
			return interaction.editReply(errorReply('That user is not currently timed out.'));
		}

		try {
			const dm = makeContainer({ color: Colors.Success, header: `Your timeout was removed in ${guild.name}` });
			dm.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Reason** ${reason}`));
			await target.send({ components: [dm], flags: CV2_FLAG }).catch(() => null);

			await target.timeout(null, `[${interaction.user.username}] ${reason}`);

			const infraction = await createInfraction({
				guildId: guild.id,
				userId: target.id,
				moderatorId: interaction.user.id,
				type: 'untimeout',
				reason,
			});

			await dispatchModLog({
				guild,
				targetUser: target.user,
				moderator: interaction.user,
				type: 'untimeout',
				reason,
				caseId: infraction.caseId,
			});

			return interaction.editReply(
				successReply(`Removed timeout from **${target.user.username}**. Case \`${infraction.caseId}\`.`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to remove timeout from the user.'));
		}
	}
}
