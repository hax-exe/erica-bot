import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Get a user\'s avatar')
        .addUserOption((option) =>
            option
                .setName('user')
                .setDescription('The user to get the avatar of (defaults to yourself)')
        ),
    category: 'fun',
    cooldown: 3,

    async execute(interaction) {
        const targetUser = interaction.options.getUser('user') || interaction.user;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`${targetUser.username}'s Avatar`)
            .setImage(targetUser.displayAvatarURL({ size: 4096 }))
            .addFields(
                {
                    name: 'Links', value: [
                        `[PNG](${targetUser.displayAvatarURL({ extension: 'png', size: 4096 })})`,
                        `[JPG](${targetUser.displayAvatarURL({ extension: 'jpg', size: 4096 })})`,
                        `[WEBP](${targetUser.displayAvatarURL({ extension: 'webp', size: 4096 })})`,
                    ].join(' | ')
                }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
