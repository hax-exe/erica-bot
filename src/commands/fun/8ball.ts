import {
    SlashCommandBuilder,
    EmbedBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption((option) =>
            option
                .setName('question')
                .setDescription('Your question')
                .setRequired(true)
        ),
    category: 'fun',
    cooldown: 3,

    async execute(interaction) {
        const question = interaction.options.getString('question', true);

        const responses = [
            // Positive
            '🟢 It is certain.',
            '🟢 It is decidedly so.',
            '🟢 Without a doubt.',
            '🟢 Yes, definitely.',
            '🟢 You may rely on it.',
            '🟢 As I see it, yes.',
            '🟢 Most likely.',
            '🟢 Outlook good.',
            '🟢 Yes.',
            '🟢 Signs point to yes.',
            // Neutral
            '🟡 Reply hazy, try again.',
            '🟡 Ask again later.',
            '🟡 Better not tell you now.',
            '🟡 Cannot predict now.',
            '🟡 Concentrate and ask again.',
            // Negative
            '🔴 Don\'t count on it.',
            '🔴 My reply is no.',
            '🔴 My sources say no.',
            '🔴 Outlook not so good.',
            '🔴 Very doubtful.',
        ];

        const response = responses[Math.floor(Math.random() * responses.length)];

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('🎱 Magic 8-Ball')
            .addFields(
                { name: 'Question', value: question },
                { name: 'Answer', value: response! },
            )
            .setFooter({ text: `Asked by ${interaction.user.tag}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    },
});
