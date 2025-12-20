import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

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

        if (!player) {
            await interaction.reply({
                content: '❌ No music player is active.',
                ephemeral: true,
            });
            return;
        }

        // Get the previous track from player data
        const previousTrack = player.data.get('previousTrack') as any;

        if (!previousTrack) {
            await interaction.reply({
                content: '❌ No previous track available.',
                ephemeral: true,
            });
            return;
        }

        // Add current track back to queue if there is one
        if (player.queue.current) {
            player.queue.unshift(player.queue.current);
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
            player.queue.unshift(track);
            await player.skip();

            await interaction.reply(`⏮️ Playing previous track: **${track.title}**`);
        } catch {
            await interaction.reply({
                content: '❌ Failed to play the previous track.',
                ephemeral: true,
            });
        }
    },
});
