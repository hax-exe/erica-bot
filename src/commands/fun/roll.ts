import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll some dice')
        .addStringOption((option) =>
            option
                .setName('dice')
                .setDescription('Dice notation (e.g., 2d6, 1d20+5, 3d8-2)')
                .setRequired(false)
        ),
    category: 'fun',
    cooldown: 2,

    async execute(interaction) {
        const diceInput = interaction.options.getString('dice') || '1d6';

        // Parse dice notation: XdY+Z or XdY-Z
        const match = diceInput.match(/^(\d+)?d(\d+)([+-]\d+)?$/i);

        if (!match) {
            await interaction.reply({
                content: '❌ Invalid dice notation. Use format like: 2d6, 1d20+5, 3d8-2',
                ephemeral: true,
            });
            return;
        }

        const count = parseInt(match[1] || '1', 10);
        const sides = parseInt(match[2]!, 10);
        const modifier = parseInt(match[3] || '0', 10);

        if (count < 1 || count > 100) {
            await interaction.reply({
                content: '❌ You can roll between 1 and 100 dice.',
                ephemeral: true,
            });
            return;
        }

        if (sides < 2 || sides > 1000) {
            await interaction.reply({
                content: '❌ Dice must have between 2 and 1000 sides.',
                ephemeral: true,
            });
            return;
        }

        // Roll the dice
        const rolls: number[] = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }

        const sum = rolls.reduce((a, b) => a + b, 0);
        const total = sum + modifier;

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎲 Dice Roll')
            .addFields(
                { name: 'Dice', value: diceInput, inline: true },
                { name: 'Rolls', value: rolls.length <= 20 ? rolls.join(', ') : `${rolls.slice(0, 20).join(', ')}...`, inline: true },
                { name: 'Total', value: modifier !== 0 ? `${sum} ${modifier >= 0 ? '+' : ''}${modifier} = **${total}**` : `**${total}**`, inline: true },
            )
            .setFooter({ text: `Rolled by ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
