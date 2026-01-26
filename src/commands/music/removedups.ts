import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { validateVoiceChannel } from '../../utils/voiceChannel.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('removedups')
        .setDescription('Remove duplicate tracks from the queue'),
    category: 'music',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const player = client.music.players.get(interaction.guildId!);
        const validation = validateVoiceChannel(interaction, player);

        if (!validation.valid) {
            await interaction.reply({ content: validation.message, ephemeral: true });
            return;
        }

        if (validation.player.queue.length === 0) {
            await interaction.reply({
                content: '❌ The queue is empty.',
                ephemeral: true,
            });
            return;
        }

        const originalLength = validation.player.queue.length;
        const seenUris = new Set<string>();
        const uniqueTracks: any[] = [];

        // Keep track of unique tracks by URI
        for (const track of validation.player.queue) {
            const uri = track.uri || track.title;
            if (!seenUris.has(uri)) {
                seenUris.add(uri);
                uniqueTracks.push(track);
            }
        }

        const removedCount = originalLength - uniqueTracks.length;

        if (removedCount === 0) {
            await interaction.reply({
                content: '✅ No duplicate tracks found in the queue.',
                ephemeral: true,
            });
            return;
        }

        // Clear and rebuild queue
        validation.player.queue.clear();
        for (const track of uniqueTracks) {
            validation.player.queue.add(track);
        }

        await interaction.reply(`🗑️ Removed **${removedCount}** duplicate track(s) from the queue.`);
    },
});

