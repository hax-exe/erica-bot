import { Precondition } from '@sapphire/framework';
import type { ChatInputCommandInteraction, GuildMember } from 'discord.js';
import { PermissionFlagsBits } from 'discord.js';
import { db } from '../lib/database/client.js';
import { guilds } from '../lib/database/schema/index.js';
import { eq } from 'drizzle-orm';

export class ModeratorOnlyPrecondition extends Precondition {
  public constructor(context: Precondition.LoaderContext, options: Precondition.Options) {
    super(context, {
      ...options,
      name: 'ModeratorOnly'
    });
  }

  public override async chatInputRun(interaction: ChatInputCommandInteraction) {
    const member = interaction.member as GuildMember;

    if (!member || !interaction.guildId) {
      return this.error({ message: 'This command can only be used in a server.' });
    }

    if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return this.ok();
    }

    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
      return this.ok();
    }

    try {
      const [guildSettings] = await db
        .select()
        .from(guilds)
        .where(eq(guilds.id, interaction.guildId))
        .limit(1);

      if (guildSettings?.modRoleId && member.roles.cache.has(guildSettings.modRoleId)) {
        return this.ok();
      }
    } catch (error) {
      this.container.logger.error('Failed to check mod role from database:', error);
    }

    return this.error({ message: 'You do not have permission to use this command. You need the Moderate Members permission or the configured moderator role.' });
  }
}

declare module '@sapphire/framework' {
  interface Preconditions {
    ModeratorOnly: never;
  }
}
