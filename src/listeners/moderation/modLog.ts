import { Listener } from '@sapphire/framework';
import type { TextChannel } from 'discord.js';
import { EricaEmbed } from '../../lib/utils/embed.js';
import { db } from '../../lib/database/client.js';
import { guilds } from '../../lib/database/schema/index.js';
import { eq } from 'drizzle-orm';

interface ModerationActionPayload {
  guildId: string;
  caseNumber: number;
  type: string;
  target: { id: string; tag: string };
  moderator: { id: string; tag: string };
  reason: string;
  duration?: string;
}

const ACTION_COLORS: Record<string, number> = {
  warn: 0xfacc15,
  ban: 0xef4444,
  kick: 0xf97316,
  timeout: 0x3b82f6
};

const ACTION_EMOJIS: Record<string, string> = {
  warn: '⚠️',
  ban: '🔨',
  kick: '👢',
  timeout: '⏱️'
};

export class ModLogListener extends Listener {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: 'moderationAction'
    });
  }

  public async run(data: ModerationActionPayload) {
    try {
      const [guildSettings] = await db
        .select()
        .from(guilds)
        .where(eq(guilds.id, data.guildId))
        .limit(1);

      if (!guildSettings?.modLogChannelId) return;

      const channel = await this.container.client.channels.fetch(guildSettings.modLogChannelId).catch(() => null);

      if (!channel || !('send' in channel)) return;

      const emoji = ACTION_EMOJIS[data.type] ?? '📋';
      const color = ACTION_COLORS[data.type] ?? 0x7c3aed;

      const embed = new EricaEmbed()
        .setTitle(`${emoji} ${data.type.charAt(0).toUpperCase() + data.type.slice(1)} — Case #${data.caseNumber}`)
        .setColor(color)
        .addFields(
          { name: 'Target', value: `<@${data.target.id}> (${data.target.tag})`, inline: true },
          { name: 'Moderator', value: `<@${data.moderator.id}> (${data.moderator.tag})`, inline: true },
          { name: 'Reason', value: data.reason, inline: false },
          ...(data.duration ? [{ name: 'Duration', value: data.duration, inline: true }] : [])
        );

      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
      this.container.logger.error('Failed to send mod log:', error);
    }
  }
}
