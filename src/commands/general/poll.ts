import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';

@ApplyOptions<Command.Options>({
	name: 'poll',
	description: 'Create a native Discord poll in this channel.',
})
export class PollCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('poll')
				.setDescription('Create a native Discord poll in this channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
				.addStringOption((o) =>
					o.setName('question').setDescription('The poll question.').setRequired(true).setMaxLength(300),
				)
				.addStringOption((o) => o.setName('option1').setDescription('First option.').setRequired(true).setMaxLength(55))
				.addStringOption((o) =>
					o.setName('option2').setDescription('Second option.').setRequired(true).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option3').setDescription('Third option.').setRequired(false).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option4').setDescription('Fourth option.').setRequired(false).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option5').setDescription('Fifth option.').setRequired(false).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option6').setDescription('Sixth option.').setRequired(false).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option7').setDescription('Seventh option.').setRequired(false).setMaxLength(55),
				)
				.addStringOption((o) =>
					o.setName('option8').setDescription('Eighth option.').setRequired(false).setMaxLength(55),
				)
				.addIntegerOption((o) =>
					o
						.setName('duration')
						.setDescription('How long the poll runs in hours (1–168, default 24).')
						.setMinValue(1)
						.setMaxValue(168)
						.setRequired(false),
				)
				.addBooleanOption((o) =>
					o
						.setName('multiselect')
						.setDescription('Allow voting for multiple options (default: false).')
						.setRequired(false),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const question = interaction.options.getString('question', true);
		const duration = interaction.options.getInteger('duration') ?? 24;
		const multiselect = interaction.options.getBoolean('multiselect') ?? false;

		const answers = (
			[
				interaction.options.getString('option1'),
				interaction.options.getString('option2'),
				interaction.options.getString('option3'),
				interaction.options.getString('option4'),
				interaction.options.getString('option5'),
				interaction.options.getString('option6'),
				interaction.options.getString('option7'),
				interaction.options.getString('option8'),
			] as (string | null)[]
		)
			.filter((o): o is string => o !== null)
			.map((text) => ({ text }));

		const channel = interaction.channel;
		if (!channel?.isTextBased()) return interaction.editReply(errorReply('Cannot post a poll here.'));

		await channel.send({
			poll: {
				question: { text: question },
				answers,
				duration,
				allowMultiselect: multiselect,
			},
		});

		return interaction.editReply(successReply('Poll created!'));
	}
}
