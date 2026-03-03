import { SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Connect the bot to your voice channel'),
    category: 'music',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const member = interaction.member;

        // @ts-expect-error - Voice state exists on GuildMember
        const vc = member?.voice?.channel;

        if (!vc) {
            await interaction.reply({
                content: '❌ You must be in a voice channel to use this command.',
                ephemeral: true,
            });
            return;
        }

        const player = client.music.players.get(interaction.guildId!);

        if (player) {
            // Already connected
            if (player.voiceId === vc.id) {
                await interaction.reply({
                    content: '✅ Already connected to your voice channel.',
                    ephemeral: true,
                });
            } else {
                // Move to new channel
                player.setVoiceChannel(vc.id);
                await interaction.reply(`📡 Moved to **${vc.name}**`);
            }
            return;
        }

        // Create new player
        await client.music.createPlayer({
            guildId: interaction.guildId!,
            textId: interaction.channelId,
            voiceId: vc.id,
            volume: 50,
            deaf: true,
        });

        await interaction.reply(`📡 Connected to **${vc.name}**`);
    },
});
