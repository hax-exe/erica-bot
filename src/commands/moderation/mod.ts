import { Subcommand } from '@sapphire/plugin-subcommands';
import { PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { EricaEmbed } from '../../lib/utils/embed.js';
import { Paginator } from '../../lib/utils/paginator.js';
import { parseDuration, formatDuration } from '../../lib/utils/time.js';
import { db } from '../../lib/database/client.js';
import { moderationCases } from '../../lib/database/schema/index.js';
import { eq, and, desc } from 'drizzle-orm';

export class ModCommand extends Subcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, {
      ...options,
      name: 'mod',
      description: 'Moderation commands',
      preconditions: ['ModeratorOnly'],
      subcommands: [
        { name: 'warn', chatInputRun: 'chatInputWarn' },
        { name: 'ban', chatInputRun: 'chatInputBan' },
        { name: 'kick', chatInputRun: 'chatInputKick' },
        { name: 'timeout', chatInputRun: 'chatInputTimeout' },
        { name: 'cases', chatInputRun: 'chatInputCases' },
        { name: 'case', chatInputRun: 'chatInputCase' }
      ]
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('mod')
        .setDescription('Moderation commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('warn')
            .setDescription('Warn a user')
            .addUserOption((opt) => opt.setName('user').setDescription('The target user').setRequired(true))
            .addStringOption((opt) => opt.setName('reason').setDescription('The reason for the warning').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('ban')
            .setDescription('Ban a user')
            .addUserOption((opt) => opt.setName('user').setDescription('The target user').setRequired(true))
            .addStringOption((opt) => opt.setName('reason').setDescription('The reason for the ban').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('kick')
            .setDescription('Kick a user')
            .addUserOption((opt) => opt.setName('user').setDescription('The target user').setRequired(true))
            .addStringOption((opt) => opt.setName('reason').setDescription('The reason for the kick').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('timeout')
            .setDescription('Timeout a user')
            .addUserOption((opt) => opt.setName('user').setDescription('The target user').setRequired(true))
            .addStringOption((opt) => opt.setName('duration').setDescription('Duration of the timeout (e.g. 1h, 30m, 1d)').setRequired(true))
            .addStringOption((opt) => opt.setName('reason').setDescription('The reason for the timeout').setRequired(false))
        )
        .addSubcommand((sub) =>
          sub
            .setName('cases')
            .setDescription('View all moderation cases for a user')
            .addUserOption((opt) => opt.setName('user').setDescription('The target user').setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName('case')
            .setDescription('View a specific moderation case')
            .addIntegerOption((opt) => opt.setName('number').setDescription('The case number to look up').setRequired(true).setMinValue(1))
        )
    );
  }

  private async createCase(
    guildId: string,
    type: 'warn' | 'ban' | 'kick' | 'timeout',
    targetId: string,
    moderatorId: string,
    reason: string,
    duration?: number | null
  ) {
    const existing = await db
      .select()
      .from(moderationCases)
      .where(eq(moderationCases.guildId, guildId))
      .orderBy(desc(moderationCases.caseNumber))
      .limit(1);

    const caseNumber = existing.length > 0 ? existing[0]!.caseNumber + 1 : 1;

    await db.insert(moderationCases).values({
      guildId,
      caseNumber,
      type,
      targetUserId: targetId,
      moderatorId,
      reason,
      duration: duration ?? null
    });

    return caseNumber;
  }

  private async notifyUser(member: GuildMember, action: string, guildName: string, reason: string, duration?: string | null) {
    try {
      const embed = EricaEmbed.warn()
        .setTitle(`You have been ${action} in ${guildName}`)
        .addFields(
          { name: 'Reason', value: reason },
          ...(duration ? [{ name: 'Duration', value: duration }] : [])
        );

      await member.send({ embeds: [embed] });
    } catch {
      // User may have DMs disabled
    }
  }

  private emitModAction(
    interaction: ChatInputCommandInteraction,
    caseNumber: number,
    type: string,
    target: GuildMember,
    reason: string,
    duration?: string | null
  ) {
    this.container.client.emit('moderationAction', {
      guildId: interaction.guildId!,
      caseNumber,
      type,
      target: { id: target.id, tag: target.user.tag },
      moderator: { id: interaction.user.id, tag: interaction.user.tag },
      reason,
      duration: duration ?? undefined
    });
  }

  public async chatInputWarn(interaction: Subcommand.ChatInputCommandInteraction) {
    const target = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('User not found in this server.')], ephemeral: true });
    }

    const caseNumber = await this.createCase(interaction.guildId!, 'warn', target.id, interaction.user.id, reason);

    await this.notifyUser(target, 'warned', interaction.guild!.name, reason);
    this.emitModAction(interaction, caseNumber, 'warn', target, reason);

    return interaction.reply({
      embeds: [
        EricaEmbed.success()
          .setTitle('User Warned')
          .setDescription(`Successfully warned **${target.user.tag}**.`)
          .addFields(
            { name: 'Case', value: `#${caseNumber}`, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
      ]
    });
  }

  public async chatInputBan(interaction: Subcommand.ChatInputCommandInteraction) {
    const target = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('User not found in this server.')], ephemeral: true });
    }

    if (!target.bannable) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('I cannot ban this user. They may have a higher role than me.')], ephemeral: true });
    }

    await this.notifyUser(target, 'banned', interaction.guild!.name, reason);

    await interaction.guild!.members.ban(target, { reason });

    const caseNumber = await this.createCase(interaction.guildId!, 'ban', target.id, interaction.user.id, reason);
    this.emitModAction(interaction, caseNumber, 'ban', target, reason);

    return interaction.reply({
      embeds: [
        EricaEmbed.success()
          .setTitle('User Banned')
          .setDescription(`Successfully banned **${target.user.tag}**.`)
          .addFields(
            { name: 'Case', value: `#${caseNumber}`, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
      ]
    });
  }

  public async chatInputKick(interaction: Subcommand.ChatInputCommandInteraction) {
    const target = interaction.options.getMember('user') as GuildMember | null;
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('User not found in this server.')], ephemeral: true });
    }

    if (!target.kickable) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('I cannot kick this user. They may have a higher role than me.')], ephemeral: true });
    }

    await this.notifyUser(target, 'kicked', interaction.guild!.name, reason);

    await target.kick(reason);

    const caseNumber = await this.createCase(interaction.guildId!, 'kick', target.id, interaction.user.id, reason);
    this.emitModAction(interaction, caseNumber, 'kick', target, reason);

    return interaction.reply({
      embeds: [
        EricaEmbed.success()
          .setTitle('User Kicked')
          .setDescription(`Successfully kicked **${target.user.tag}**.`)
          .addFields(
            { name: 'Case', value: `#${caseNumber}`, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
      ]
    });
  }

  public async chatInputTimeout(interaction: Subcommand.ChatInputCommandInteraction) {
    const target = interaction.options.getMember('user') as GuildMember | null;
    const durationStr = interaction.options.getString('duration', true);
    const reason = interaction.options.getString('reason') ?? 'No reason provided';

    if (!target) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('User not found in this server.')], ephemeral: true });
    }

    if (!target.moderatable) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('I cannot timeout this user. They may have a higher role than me.')], ephemeral: true });
    }

    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('Invalid duration format. Use formats like `1h`, `30m`, `1d`.')], ephemeral: true });
    }

    const formattedDuration = formatDuration(durationMs);

    await target.timeout(durationMs, reason);

    const caseNumber = await this.createCase(interaction.guildId!, 'timeout', target.id, interaction.user.id, reason, durationMs);
    await this.notifyUser(target, 'timed out', interaction.guild!.name, reason, formattedDuration);
    this.emitModAction(interaction, caseNumber, 'timeout', target, reason, formattedDuration);

    return interaction.reply({
      embeds: [
        EricaEmbed.success()
          .setTitle('User Timed Out')
          .setDescription(`Successfully timed out **${target.user.tag}** for ${formattedDuration}.`)
          .addFields(
            { name: 'Case', value: `#${caseNumber}`, inline: true },
            { name: 'Duration', value: formattedDuration, inline: true },
            { name: 'Reason', value: reason, inline: true }
          )
      ]
    });
  }

  public async chatInputCases(interaction: Subcommand.ChatInputCommandInteraction) {
    const targetUser = interaction.options.getUser('user', true);

    const cases = await db
      .select()
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.guildId, interaction.guildId!),
          eq(moderationCases.targetUserId, targetUser.id)
        )
      )
      .orderBy(desc(moderationCases.caseNumber));

    if (cases.length === 0) {
      return interaction.reply({
        embeds: [EricaEmbed.info().setDescription(`No moderation cases found for **${targetUser.tag}**.`)],
        ephemeral: true
      });
    }

    const itemsPerPage = 10;
    const pages: EricaEmbed[] = [];

    for (let i = 0; i < cases.length; i += itemsPerPage) {
      const pageCases = cases.slice(i, i + itemsPerPage);
      const embed = new EricaEmbed()
        .setTitle(`Moderation Cases for ${targetUser.tag}`)
        .setThumbnail(targetUser.displayAvatarURL())
        .setDescription(
          pageCases
            .map(
              (c) =>
                `**Case #${c.caseNumber}** — \`${c.type.toUpperCase()}\`\n` +
                `Moderator: <@${c.moderatorId}>\n` +
                `Reason: ${c.reason ?? 'No reason provided'}\n` +
                (c.duration ? `Duration: ${formatDuration(c.duration)}\n` : '') +
                `<t:${Math.floor(c.createdAt.getTime() / 1000)}:R>`
            )
            .join('\n\n')
        )
        .setFooter({ text: `Page ${Math.floor(i / itemsPerPage) + 1} of ${Math.ceil(cases.length / itemsPerPage)} • ${cases.length} total cases` });

      pages.push(embed);
    }

    const paginator = new Paginator(pages);
    return paginator.send(interaction);
  }

  public async chatInputCase(interaction: Subcommand.ChatInputCommandInteraction) {
    const caseNumber = interaction.options.getInteger('number', true);

    const [modCase] = await db
      .select()
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.guildId, interaction.guildId!),
          eq(moderationCases.caseNumber, caseNumber)
        )
      )
      .limit(1);

    if (!modCase) {
      return interaction.reply({
        embeds: [EricaEmbed.error().setDescription(`Case **#${caseNumber}** was not found.`)],
        ephemeral: true
      });
    }

    const typeColors: Record<string, number> = {
      warn: 0xfacc15,
      ban: 0xef4444,
      kick: 0xf97316,
      timeout: 0x3b82f6
    };

    const embed = new EricaEmbed()
      .setTitle(`Case #${modCase.caseNumber}`)
      .setColor(typeColors[modCase.type] ?? 0x7c3aed)
      .addFields(
        { name: 'Type', value: modCase.type.toUpperCase(), inline: true },
        { name: 'Target', value: `<@${modCase.targetUserId}>`, inline: true },
        { name: 'Moderator', value: `<@${modCase.moderatorId}>`, inline: true },
        { name: 'Reason', value: modCase.reason ?? 'No reason provided', inline: false },
        ...(modCase.duration ? [{ name: 'Duration', value: formatDuration(modCase.duration), inline: true }] : []),
        { name: 'Date', value: `<t:${Math.floor(modCase.createdAt.getTime() / 1000)}:F>`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }
}
