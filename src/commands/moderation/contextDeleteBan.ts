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
	name: 'Delete & Ban',
	preconditions: ['Moderation'],
})
export class DeleteBanContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('Delete & Ban')
				.setType(ApplicationCommandType.Message)
				.setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand()) return;

		const message = interaction.targetMessage;
		const modal = new ModalBuilder()
			.setCustomId(`ctx:delban:${message.author.id}:${message.id}`)
			.setTitle('Delete & Ban User')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('delete_days')
						.setLabel('Message history delete days (0-7)')
						.setStyle(TextInputStyle.Short)
						.setRequired(true)
						.setValue('0')
						.setMaxLength(1),
				),
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('reason')
						.setLabel('Reason for ban')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(false)
						.setMaxLength(512),
				),
			);

		await interaction.showModal(modal);
	}
}
