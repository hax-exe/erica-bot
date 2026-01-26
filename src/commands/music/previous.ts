import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Play the previous track'),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const player = client.music.players.get(interaction.guildId!);
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        // Get the previous track from player data
        const previousTrack = validation.player.data.get('previousTrack') as any;

        if (!previousTrack) {
            await interaction.reply({
                content: '❌ No previous track available.',
                ephemeral: true,
            });
            return;
        }

        // Add current track back to queue if there is one
        if (validation.player.queue.current) {
            validation.player.queue.unshift(validation.player.queue.current);
        }

        // Search and play the previous track
        try {
            const result = await client.music.search(previousTrack.uri, { requester: interaction.user });

            if (!result.tracks.length) {
                await interaction.reply({
                    content: '❌ Could not find the previous track.',
                    ephemeral: true,
                });
                return;
            }

            const track = result.tracks[0]!;
            validation.player.queue.unshift(track);
            await validation.player.skip();

            await interaction.reply(`⏮️ Playing previous track: **${track.title}**`);
        } catch {
            await interaction.reply({
                content: '❌ Failed to play the previous track.',
                ephemeral: true,
            });
        }
    },
});

