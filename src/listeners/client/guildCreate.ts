import { Listener, Events } from '@sapphire/framework';
import type { Guild } from 'discord.js';
import { db } from '../../lib/database/client.js';
import { guilds } from '../../lib/database/schema/index.js';

export class GuildCreateListener extends Listener<typeof Events.GuildCreate> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.GuildCreate
    });
  }

  public async run(guild: Guild) {
    try {
      await db
        .insert(guilds)
        .values({
          id: guild.id
        })
        .onConflictDoNothing();

      this.container.logger.info(`Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);
    } catch (error) {
      this.container.logger.error(`Failed to insert guild settings for ${guild.name} (${guild.id}):`, error);
    }
  }
}
