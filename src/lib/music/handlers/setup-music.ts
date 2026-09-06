import { type Command, container } from '@sapphire/framework';
import { ChannelType, MessageFlags, type TextChannel } from 'discord.js';
import { eq } from 'drizzle-orm';
import { CV2_FLAG, errorReply, idleJukeboxCard, successReply } from '../../components.js';
import { db, schema } from '../../database.js';

export class SetupMusicHandler {
	public async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.guild) return;

		try {
			const action = interaction.options.getString('action', true);
			const guildRow = await db.query.guilds.findFirst({
				where: eq(schema.guilds.id, interaction.guild.id),
			});

			if (action === 'destroy') {
				if (!guildRow?.musicChannelId) {
					return interaction.editReply(errorReply('There is no dedicated music channel to destroy.'));
				}

				const existing =
					interaction.guild.channels.cache.get(guildRow.musicChannelId) ??
					(await interaction.guild.channels.fetch(guildRow.musicChannelId).catch(() => null));
				if (existing) await existing.delete('Dedicated Jukebox removed');

				await db
					.update(schema.guilds)
					.set({ musicChannelId: null, musicMessageId: null })
					.where(eq(schema.guilds.id, interaction.guild.id));
				return interaction.editReply(successReply('The dedicated music channel was removed.'));
			}

			if (guildRow?.musicChannelId) {
				const existing = interaction.guild.channels.cache.get(guildRow.musicChannelId);
				if (existing) {
					return interaction.editReply(errorReply(`The music channel is already set up at <#${existing.id}>.`));
				}
			}

			const channel = (await interaction.guild.channels.create({
				name: 'music',
				type: ChannelType.GuildText,
				topic: 'Type a song name or URL here to play it',
				reason: 'Dedicated Jukebox setup',
			})) as TextChannel;

			const uiMessage = await channel.send({ components: [idleJukeboxCard()], flags: CV2_FLAG });

			await db
				.insert(schema.guilds)
				.values({
					id: interaction.guild.id,
					musicChannelId: channel.id,
					musicMessageId: uiMessage.id,
				})
				.onDuplicateKeyUpdate({
					set: {
						musicChannelId: channel.id,
						musicMessageId: uiMessage.id,
					},
				});

			await interaction.editReply(successReply(`Jukebox created successfully: <#${channel.id}>`));
		} catch (err) {
			container.logger.error('[SetupMusic]', err);
			await interaction.editReply(errorReply(`Failed to set up the music channel: \`${(err as Error).message}\``));
		}
	}
}
