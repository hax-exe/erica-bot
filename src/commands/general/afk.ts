import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Command.Options>({
	name: 'afk',
	description: 'Set your AFK status. You will be marked as away until you next send a message.',
})
export class AfkCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('afk')
				.setDescription('Set your AFK status.')
				.addStringOption((o) =>
					o.setName('reason').setDescription('Why are you going AFK? (optional)').setRequired(false).setMaxLength(200),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const reason = interaction.options.getString('reason') ?? 'AFK';

		await db
			.insert(schema.afkStatuses)
			.values({ userId: interaction.user.id, guildId: interaction.guildId, reason })
			.onDuplicateKeyUpdate({
				set: { reason, setAt: new Date() },
			});

		return interaction.editReply(
			successReply(`You're now AFK: **${reason}**\nI'll let people know when they mention you.`),
		);
	}
}
