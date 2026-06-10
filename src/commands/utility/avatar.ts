import { Command } from '@sapphire/framework';
import { EricaEmbed } from '../../lib/utils/embed.js';

export class AvatarCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'avatar',
      description: 'Display a user\'s avatar'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('avatar')
        .setDescription('Display a user\'s avatar')
        .addUserOption((opt) => opt.setName('user').setDescription('The user whose avatar to display').setRequired(false))
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;

    const png = targetUser.displayAvatarURL({ extension: 'png', size: 4096 });
    const jpg = targetUser.displayAvatarURL({ extension: 'jpg', size: 4096 });
    const webp = targetUser.displayAvatarURL({ extension: 'webp', size: 4096 });
    const gif = targetUser.avatarURL({ extension: 'gif', size: 4096 });

    const formats = [
      `[PNG](${png})`,
      `[JPG](${jpg})`,
      `[WEBP](${webp})`,
      ...(gif ? [`[GIF](${gif})`] : [])
    ];

    const embed = new EricaEmbed()
      .setTitle(`${targetUser.tag}'s Avatar`)
      .setDescription(`Download: ${formats.join(' • ')}`)
      .setImage(targetUser.displayAvatarURL({ size: 4096 }));

    return interaction.reply({ embeds: [embed] });
  }
}
