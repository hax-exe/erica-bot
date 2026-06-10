import { Command } from '@sapphire/framework';
import { EricaEmbed } from '../../lib/utils/embed.js';

const NUMBER_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'] as const;

export class PollCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'poll',
      description: 'Create a poll'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('poll')
        .setDescription('Create a poll')
        .setDMPermission(false)
        .addStringOption((opt) => opt.setName('question').setDescription('The poll question').setRequired(true))
        .addStringOption((opt) => opt.setName('option1').setDescription('First option').setRequired(true))
        .addStringOption((opt) => opt.setName('option2').setDescription('Second option').setRequired(true))
        .addStringOption((opt) => opt.setName('option3').setDescription('Third option').setRequired(false))
        .addStringOption((opt) => opt.setName('option4').setDescription('Fourth option').setRequired(false))
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const question = interaction.options.getString('question', true);

    const options: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const option = interaction.options.getString(`option${i}`);
      if (option) options.push(option);
    }

    const description = options
      .map((option, index) => `${NUMBER_EMOJIS[index]} ${option}`)
      .join('\n\n');

    const embed = new EricaEmbed()
      .setTitle(`📊 ${question}`)
      .setDescription(description)
      .setFooter({ text: `Poll by ${interaction.user.tag} • React to vote!` });

    const message = await interaction.reply({ embeds: [embed], fetchReply: true });

    for (let i = 0; i < options.length; i++) {
      await message.react(NUMBER_EMOJIS[i]!);
    }
  }
}
