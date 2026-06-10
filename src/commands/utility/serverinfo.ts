import { Command } from '@sapphire/framework';
import { ChannelType } from 'discord.js';
import { EricaEmbed } from '../../lib/utils/embed.js';
import { formatRelative } from '../../lib/utils/time.js';

export class ServerInfoCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'serverinfo',
      description: 'Display information about this server'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('serverinfo')
        .setDescription('Display information about this server')
        .setDMPermission(false)
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const guild = interaction.guild!;
    const owner = await guild.fetchOwner();

    const textChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter((c) => c.type === ChannelType.GuildVoice).size;
    const categories = guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).size;
    const totalChannels = guild.channels.cache.size;

    const boostTierNames: Record<number, string> = {
      0: 'None',
      1: 'Tier 1',
      2: 'Tier 2',
      3: 'Tier 3'
    };

    const verificationLevels: Record<number, string> = {
      0: 'None',
      1: 'Low',
      2: 'Medium',
      3: 'High',
      4: 'Very High'
    };

    const embed = new EricaEmbed()
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 512 }) ?? null)
      .addFields(
        { name: 'Server ID', value: guild.id, inline: true },
        { name: 'Owner', value: `${owner.user.tag}\n${owner}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>\n(${formatRelative(guild.createdAt)})`, inline: true },
        {
          name: `Members [${guild.memberCount}]`,
          value: [
            `👤 Humans: ${guild.memberCount - (guild.members.cache.filter((m) => m.user.bot).size)}`,
            `🤖 Bots: ${guild.members.cache.filter((m) => m.user.bot).size}`
          ].join('\n'),
          inline: true
        },
        {
          name: `Channels [${totalChannels}]`,
          value: [
            `💬 Text: ${textChannels}`,
            `🔊 Voice: ${voiceChannels}`,
            `📁 Categories: ${categories}`
          ].join('\n'),
          inline: true
        },
        { name: `Roles [${guild.roles.cache.size}]`, value: `Use \`/roles\` to see all roles`, inline: true },
        {
          name: 'Boost Status',
          value: [
            `Level: ${boostTierNames[guild.premiumTier] ?? 'Unknown'}`,
            `Boosts: ${guild.premiumSubscriptionCount ?? 0}`,
            `Boosters: ${guild.members.cache.filter((m) => m.premiumSince).size}`
          ].join('\n'),
          inline: true
        },
        { name: 'Verification Level', value: verificationLevels[guild.verificationLevel] ?? 'Unknown', inline: true },
        {
          name: 'Features',
          value: guild.features.length > 0
            ? guild.features
                .slice(0, 10)
                .map((f) => `\`${f.replace(/_/g, ' ').toLowerCase()}\``)
                .join(', ')
            : 'None',
          inline: false
        }
      );

    if (guild.bannerURL()) {
      embed.setImage(guild.bannerURL({ size: 1024 })!);
    }

    return interaction.reply({ embeds: [embed] });
  }
}
