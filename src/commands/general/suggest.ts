import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, type TextChannel } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { buildSuggestionContainer, getSuggestionSettings } from '../../lib/SuggestionUtil.js';

@ApplyOptions<Subcommand.Options>({
	name: 'suggest',
	description: 'Submit or manage your suggestions.',
	subcommands: [
		{ name: 'submit', chatInputRun: 'runSubmit' },
		{ name: 'edit', chatInputRun: 'runEdit' },
	],
})
export class SuggestCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('suggest')
				.setDescription('Submit or manage your suggestions.')
				.addSubcommand((sub) =>
					sub
						.setName('submit')
						.setDescription('Submit a suggestion to the server.')
						.addStringOption((o) =>
							o
								.setName('idea')
								.setDescription('Your suggestion.')
								.setRequired(true)
								.setMinLength(10)
								.setMaxLength(1000),
						),
				)
				.addSubcommand((sub) =>
					sub
						.setName('edit')
						.setDescription('Edit your own pending suggestion.')
						.addIntegerOption((o) =>
							o.setName('id').setDescription('The suggestion ID.').setRequired(true).setMinValue(1),
						)
						.addStringOption((o) =>
							o
								.setName('content')
								.setDescription('The updated suggestion text.')
								.setRequired(true)
								.setMinLength(10)
								.setMaxLength(1000),
						),
				),
		);
	}

	public async runSubmit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		if (!(await isModuleEnabled(interaction.guild.id, 'suggestions'))) {
			return interaction.editReply(errorReply('The suggestions module is disabled on this server.'));
		}

		const settings = await getSuggestionSettings(interaction.guild.id);
		if (!settings?.channelId) {
			return interaction.editReply(
				errorReply('Suggestions are not configured yet. Ask a moderator to run `/suggestion setup channel`.'),
			);
		}

		const channel = interaction.guild.channels.cache.get(settings.channelId) as TextChannel | undefined;
		if (!channel?.isTextBased()) {
			return interaction.editReply(errorReply('The suggestion channel no longer exists. Please contact a moderator.'));
		}

		const content = interaction.options.getString('idea', true).trim();

		const [idRow] = await db
			.insert(schema.suggestions)
			.values({
				guildId: interaction.guild.id,
				userId: interaction.user.id,
				channelId: channel.id,
				messageId: '0',
				content,
			})
			.$returningId();
		const [suggestion] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, idRow.id)).limit(1);
		if (!suggestion) return interaction.editReply(errorReply('Failed to create suggestion.'));

		const msg = await channel.send({ components: [buildSuggestionContainer(suggestion)], flags: CV2_FLAG });
		await db.update(schema.suggestions).set({ messageId: msg.id }).where(eq(schema.suggestions.id, suggestion.id));

		await msg
			.startThread({
				name: `💬 Suggestion #${suggestion.id} Discussion`,
				reason: `Discussion thread for suggestion #${suggestion.id}`,
			})
			.catch(() => null);

		return interaction.editReply(successReply(`Your suggestion has been posted in <#${channel.id}>!`));
	}

	public async runEdit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const id = interaction.options.getInteger('id', true);
		const newContent = interaction.options.getString('content', true).trim();

		const suggestion = await db.query.suggestions.findFirst({
			where: and(eq(schema.suggestions.id, id), eq(schema.suggestions.guildId, interaction.guild.id)),
		});

		if (!suggestion) return interaction.editReply(errorReply(`Suggestion #${id} not found.`));
		if (suggestion.userId !== interaction.user.id)
			return interaction.editReply(errorReply('You can only edit your own suggestions.'));
		if (suggestion.status !== 'pending')
			return interaction.editReply(
				errorReply(`Suggestion #${id} has already been reviewed and can no longer be edited.`),
			);

		await db.update(schema.suggestions).set({ content: newContent }).where(eq(schema.suggestions.id, id));
		const [updated] = await db.select().from(schema.suggestions).where(eq(schema.suggestions.id, id)).limit(1);
		if (!updated) return interaction.editReply(errorReply(`Suggestion #${id} not found.`));

		// Update the message in the suggestion channel
		const channel = interaction.guild.channels.cache.get(suggestion.channelId) as TextChannel | undefined;
		if (channel?.isTextBased()) {
			const msg = await channel.messages.fetch(suggestion.messageId).catch(() => null);
			if (msg) {
				await msg.edit({ components: [buildSuggestionContainer(updated)], flags: CV2_FLAG }).catch(() => null);
			}
		}

		return interaction.editReply(successReply(`Suggestion #${id} updated.`));
	}
}
