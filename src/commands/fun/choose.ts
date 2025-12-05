import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Let the bot choose between options')
        .addStringOption((option) =>
            option
                .setName('options')
                .setDescription('Options separated by commas (e.g., pizza, burger, sushi)')
                .setRequired(true)
        ),
    category: 'fun',
    cooldown: 2,

    async execute(interaction) {
        const input = interaction.options.getString('options', true);
        const options = input.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

        if (options.length < 2) {
            await interaction.reply({
                content: '❌ Please provide at least 2 options separated by commas.',
                ephemeral: true,
            });
            return;
        }

        const choice = options[Math.floor(Math.random() * options.length)];

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🤔 I Choose...')
            .setDescription(`**${choice}**`)
            .addFields({
                name: 'Options',
                value: options.map((o) => `• ${o}`).join('\n'),
            })
            .setFooter({ text: `Asked by ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
