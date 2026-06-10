import { Command } from '@sapphire/framework';
import type { GuildMember } from 'discord.js';
import { EricaEmbed } from '../../lib/utils/embed.js';
import { formatRelative } from '../../lib/utils/time.js';

export class UserInfoCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'userinfo',
      description: 'Display information about a user'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('userinfo')
        .setDescription('Display information about a user')
        .setDMPermission(false)
        .addUserOption((opt) => opt.setName('user').setDescription('The user to look up').setRequired(false))
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const member = interaction.options.getMember('user') as GuildMember | null ?? interaction.member as GuildMember;

    const roles = member.roles.cache
      .filter((role) => role.id !== interaction.guildId)
      .sort((a, b) => b.position - a.position)
      .map((role) => `${role}`)
      .join(', ');

    const boostStatus = member.premiumSince
      ? `Boosting since ${formatRelative(member.premiumSince)}`
      : 'Not boosting';

    const badges = targetUser.flags?.toArray().map((flag) => {
      const badgeMap: Record<string, string> = {
        Staff: '<:staff:1>',
        Partner: '<:partner:1>',
        Hypesquad: '<:hypesquad:1>',
        BugHunterLevel1: '<:bughunter:1>',
        BugHunterLevel2: '<:bughunter2:1>',
        HypeSquadOnlineHouse1: '🏠 Bravery',
        HypeSquadOnlineHouse2: '🏠 Brilliance',
        HypeSquadOnlineHouse3: '🏠 Balance',
        PremiumEarlySupporter: '👑 Early Supporter',
        VerifiedDeveloper: '✅ Verified Developer',
        ActiveDeveloper: '🔧 Active Developer'
      };
      return badgeMap[flag] ?? flag;
    }) ?? [];

    const embed = new EricaEmbed()
      .setTitle(`${targetUser.tag}`)
      .setThumbnail(targetUser.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: 'User ID', value: targetUser.id, inline: true },
        { name: 'Display Name', value: member.displayName, inline: true },
        { name: 'Bot', value: targetUser.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(targetUser.createdTimestamp / 1000)}:F>\n(${formatRelative(targetUser.createdAt)})`, inline: true },
        { name: 'Joined Server', value: member.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:F>\n(${formatRelative(member.joinedAt)})` : 'Unknown', inline: true },
        { name: 'Boost Status', value: boostStatus, inline: true },
        { name: `Roles [${member.roles.cache.size - 1}]`, value: roles.length > 0 ? (roles.length > 1024 ? roles.slice(0, 1020) + '...' : roles) : 'None', inline: false }
      );

    if (badges.length > 0) {
      embed.addFields({ name: 'Badges', value: badges.join(' '), inline: false });
    }

    if (member.displayHexColor !== '#000000') {
      embed.setColor(parseInt(member.displayHexColor.replace('#', ''), 16));
    }

    return interaction.reply({ embeds: [embed] });
  }
}
