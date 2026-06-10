import { Command } from '@sapphire/framework';
import { EricaEmbed } from '../../lib/utils/embed.js';

interface MemeResponse {
  title: string;
  url: string;
  subreddit: string;
  ups: number;
  author: string;
  postLink: string;
  nsfw: boolean;
  spoiler: boolean;
}

export class MemeCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'meme',
      description: 'Get a random meme'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('meme')
        .setDescription('Get a random meme from Reddit')
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    await interaction.deferReply();

    try {
      const response = await fetch('https://meme-api.com/gimme');

      if (!response.ok) {
        return interaction.editReply({
          embeds: [EricaEmbed.error().setDescription('Failed to fetch a meme. Please try again later.')]
        });
      }

      const data = (await response.json()) as MemeResponse;

      if (data.nsfw || data.spoiler) {
        return interaction.editReply({
          embeds: [EricaEmbed.error().setDescription('The fetched meme was NSFW or a spoiler. Please try again.')]
        });
      }

      const embed = new EricaEmbed()
        .setTitle(data.title)
        .setURL(data.postLink)
        .setImage(data.url)
        .addFields(
          { name: 'Subreddit', value: `r/${data.subreddit}`, inline: true },
          { name: 'Author', value: `u/${data.author}`, inline: true },
          { name: 'Upvotes', value: `⬆️ ${data.ups.toLocaleString()}`, inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    } catch {
      return interaction.editReply({
        embeds: [EricaEmbed.error().setDescription('Failed to fetch a meme. Please try again later.')]
      });
    }
  }
}
