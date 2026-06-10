import { Command } from '@sapphire/framework';
import { EricaEmbed } from '../../lib/utils/embed.js';

const RESPONSES = [
  // Positive
  'It is certain.',
  'It is decidedly so.',
  'Without a doubt.',
  'Yes — definitely.',
  'You may rely on it.',
  'As I see it, yes.',
  'Most likely.',
  'Outlook good.',
  'Yes.',
  'Signs point to yes.',
  // Neutral
  'Reply hazy, try again.',
  'Ask again later.',
  'Better not tell you now.',
  'Cannot predict now.',
  'Concentrate and ask again.',
  // Negative
  'Don\'t count on it.',
  'My reply is no.',
  'My sources say no.',
  'Outlook not so good.',
  'Very doubtful.'
] as const;

export class EightBallCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: '8ball',
      description: 'Ask the magic 8-ball a question'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption((opt) =>
          opt.setName('question').setDescription('Your question for the magic 8-ball').setRequired(true)
        )
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);
    const response = RESPONSES[Math.floor(Math.random() * RESPONSES.length)]!;

    const index = RESPONSES.indexOf(response);
    let color: number;
    if (index < 10) {
      color = 0x22c55e; // green — positive
    } else if (index < 15) {
      color = 0xfacc15; // yellow — neutral
    } else {
      color = 0xef4444; // red — negative
    }

    const embed = new EricaEmbed()
      .setTitle('🎱 Magic 8-Ball')
      .setColor(color)
      .addFields(
        { name: 'Question', value: question, inline: false },
        { name: 'Answer', value: `**${response}**`, inline: false }
      );

    return interaction.reply({ embeds: [embed] });
  }
}
