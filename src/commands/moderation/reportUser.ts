import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ActionRowBuilder, ApplicationCommandType, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';

@ApplyOptions<Command.Options>({
	name: 'Report User',
})
export class ReportUserContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder.setName('Report User').setType(ApplicationCommandType.User),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isUserContextMenuCommand()) return;

		const modal = new ModalBuilder()
			.setCustomId(`report:user:${interaction.targetId}`)
			.setTitle('Report User')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('reason')
						.setLabel('Why are you reporting this user?')
						.setStyle(TextInputStyle.Paragraph)
						.setRequired(true)
						.setMaxLength(1000),
				),
			);

		await interaction.showModal(modal);
	}
}
