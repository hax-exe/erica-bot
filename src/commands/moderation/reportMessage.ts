import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ActionRowBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'Report Message',
})
export class ReportMessageContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder.setName('Report Message').setType(ApplicationCommandType.Message),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand()) return;

		// Custom ID: report:msg:{channelId}:{messageId}
		const modal = new ModalBuilder()
			.setCustomId(`report:msg:${interaction.channelId}:${interaction.targetId}`)
			.setTitle('Report Message')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('reason')
						.setLabel('Why are you reporting this message?')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMaxLength(1000),
				),
			);

		await interaction.showModal(modal);
	}
}
