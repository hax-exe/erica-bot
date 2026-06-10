import { ScheduledTask } from '@sapphire/plugin-scheduled-tasks';
import type { TextChannel } from 'discord.js';
import { EricaEmbed } from '../lib/utils/embed.js';

interface ReminderPayload {
  userId: string;
  channelId: string;
  message: string;
}

export class ReminderTask extends ScheduledTask {
  public constructor(context: ScheduledTask.LoaderContext, options: ScheduledTask.Options) {
    super(context, {
      ...options,
      name: 'reminder'
    });
  }

  public override async run(payload: unknown) {
    const data = payload as ReminderPayload;
    try {
      const channel = await this.container.client.channels.fetch(data.channelId).catch(() => null);

      if (!channel || !('send' in channel)) {
        this.container.logger.warn(`Reminder channel ${data.channelId} not found or is not a text channel.`);
        return;
      }

      const embed = EricaEmbed.info()
        .setTitle('⏰ Reminder')
        .setDescription(data.message);

      await (channel as TextChannel).send({
        content: `<@${data.userId}>`,
        embeds: [embed]
      });
    } catch (error) {
      this.container.logger.error('Failed to send reminder:', error);
    }
  }
}

declare module '@sapphire/plugin-scheduled-tasks' {
  interface ScheduledTasks {
    reminder: never;
  }
}
