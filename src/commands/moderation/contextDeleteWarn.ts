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
	name: 'Delete & Warn',
	preconditions: ['Moderation'],
})
export class DeleteWarnContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('Delete & Warn')
				.setType(ApplicationCommandType.Message)
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand()) return;

		const targetMessage = interaction.targetMessage;
		const targetId = targetMessage.author.id;

		const modal = new ModalBuilder()
			.setCustomId(`ctx:delwarn:${targetId}:${targetMessage.id}`)
			.setTitle('Delete Message & Warn User')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('reason')
						.setLabel('Reason for warning')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMaxLength(512),
				),
			);

		await interaction.showModal(modal);
	}
}
