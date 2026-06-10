import { Command } from '@sapphire/framework';
import { EricaEmbed } from '../../lib/utils/embed.js';
import { parseDuration, formatDuration } from '../../lib/utils/time.js';
import { db } from '../../lib/database/client.js';
import { reminders } from '../../lib/database/schema/index.js';

export class RemindCommand extends Command {
  public constructor(context: Command.LoaderContext, options: Command.Options) {
    super(context, {
      ...options,
      name: 'remind',
      description: 'Set a reminder'
    });
  }

  public override registerApplicationCommands(registry: Command.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('remind')
        .setDescription('Set a reminder')
        .addStringOption((opt) =>
          opt.setName('time').setDescription('When to remind you (e.g. 1h, 30m, 2d)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('message').setDescription('What to remind you about').setRequired(true)
        )
    );
  }

  public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
    const timeStr = interaction.options.getString('time', true);
    const message = interaction.options.getString('message', true);

    const durationMs = parseDuration(timeStr);

    if (!durationMs) {
      return interaction.reply({
        embeds: [EricaEmbed.error().setDescription('Invalid time format. Use formats like `1h`, `30m`, `2d`, `1h30m`.')],
        ephemeral: true
      });
    }

    if (durationMs < 30_000) {
      return interaction.reply({
        embeds: [EricaEmbed.error().setDescription('The minimum reminder duration is 30 seconds.')],
        ephemeral: true
      });
    }

    if (durationMs > 30 * 24 * 60 * 60 * 1000) {
      return interaction.reply({
        embeds: [EricaEmbed.error().setDescription('The maximum reminder duration is 30 days.')],
        ephemeral: true
      });
    }

    const firesAt = new Date(Date.now() + durationMs);

    await db.insert(reminders).values({
      userId: interaction.user.id,
      channelId: interaction.channelId,
      guildId: interaction.guildId,
      message,
      remindAt: firesAt
    });

    await (this.container as any).tasks.create(
      'reminder',
      {
        userId: interaction.user.id,
        channelId: interaction.channelId,
        message
      },
      durationMs
    );

    const embed = EricaEmbed.success()
      .setTitle('⏰ Reminder Set')
      .addFields(
        { name: 'Message', value: message, inline: false },
        { name: 'Fires In', value: formatDuration(durationMs), inline: true },
        { name: 'Fires At', value: `<t:${Math.floor(firesAt.getTime() / 1000)}:F>`, inline: true }
      );

    return interaction.reply({ embeds: [embed] });
  }
}
