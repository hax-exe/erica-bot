import { Listener, Events } from '@sapphire/framework';
import type { Client } from 'discord.js';
import { ActivityType } from 'discord.js';

export class ReadyListener extends Listener<typeof Events.ClientReady> {
  public constructor(context: Listener.LoaderContext, options: Listener.Options) {
    super(context, {
      ...options,
      event: Events.ClientReady,
      once: true
    });
  }

  public run(client: Client<true>) {
    const guildCount = client.guilds.cache.size;
    const userCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);

    this.container.logger.info(`Logged in as ${client.user.tag}`);
    this.container.logger.info(`Serving ${guildCount} guild${guildCount !== 1 ? 's' : ''} with ${userCount.toLocaleString()} total users`);

    client.user.setPresence({
      status: 'online',
      activities: [
        {
          name: 'Watching over the server',
          type: ActivityType.Watching
        }
      ]
    });
  }
}
