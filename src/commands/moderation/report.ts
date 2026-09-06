import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, userMention } from 'discord.js';
import { Colors, errorReply, logContainer, successReply } from '../../lib/components.js';
import { sendReportLog } from '../../lib/LoggingUtil.js';

@ApplyOptions<Command.Options>({
	name: 'report',
	description: 'Report a user to the server staff.',
})
export class ReportCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('report')
				.setDescription('Report a user to the server staff.')
				.addUserOption((o) => o.setName('user').setDescription('The user you are reporting.').setRequired(true))
				.addStringOption((o) =>
					o.setName('reason').setDescription('Why are you reporting this user?').setRequired(true).setMaxLength(1000),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.options.getUser('user', true);
		const reason = interaction.options.getString('reason', true);

		if (target.id === interaction.user.id) {
			return interaction.editReply(errorReply('You cannot report yourself.'));
		}
		if (target.bot) {
			return interaction.editReply(errorReply('You cannot report a bot.'));
		}

		const sent = await sendReportLog(
			interaction.guild,
			logContainer({
				title: 'User Report',
				color: Colors.Warning,
				fields: [
					{
						name: 'Reported User',
						value: `${userMention(target.id)} (${target.tag} · \`${target.id}\`)`,
					},
					{
						name: 'Reported By',
						value: `${userMention(interaction.user.id)} (${interaction.user.tag})`,
					},
					{ name: 'Reason', value: reason },
				],
				timestamp: true,
			}),
		);

		if (!sent) {
			return interaction.editReply(
				errorReply('Reports are not configured on this server. Please contact a staff member directly.'),
			);
		}

		return interaction.editReply(successReply('Your report has been submitted to the staff team. Thank you.'));
	}
}
