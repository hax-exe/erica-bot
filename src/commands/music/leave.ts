import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('leave')
        .setDescription('Disconnect the bot from the voice channel'),
    category: 'music',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const player = client.music.players.get(interaction.guildId!);

        if (!player) {
            await interaction.reply({
                content: '❌ I\'m not connected to a voice channel.',
                ephemeral: true,
            });
            return;
        }

        const member = interaction.member;
        // @ts-expect-error - Voice state exists on GuildMember
        const userVoiceChannel = member?.voice?.channel?.id;

        if (userVoiceChannel !== player.voiceId) {
            await interaction.reply({
                content: '❌ You must be in the same voice channel to use this command.',
                ephemeral: true,
            });
            return;
        }

        player.destroy();
        await interaction.reply('👋 Disconnected from the voice channel.');
    },
});
