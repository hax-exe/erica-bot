import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ApplicationCommandType,
	ModalBuilder,
	PermissionFlagsBits,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'Delete & Timeout',
	preconditions: ['Moderation'],
})
export class DeleteTimeoutContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('Delete & Timeout')
				.setType(ApplicationCommandType.Message)
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand()) return;

		const message = interaction.targetMessage;
		const modal = new ModalBuilder()
			.setCustomId(`ctx:deltimeout:${message.author.id}:${message.id}`)
			.setTitle('Delete & Timeout User')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('duration')
						.setLabel('Duration (e.g., 10m, 1h, 1d)')
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setMaxLength(32),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('reason')
						.setLabel('Reason for timeout')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(512),
				),
			);

		await interaction.showModal(modal);
	}
}
