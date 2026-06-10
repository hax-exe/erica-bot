import '@sapphire/plugin-logger/register';
import '@sapphire/plugin-i18next/register';
import '@sapphire/plugin-api/register';
import '@sapphire/plugin-hmr/register';
import '@sapphire/plugin-subcommands/register';
import '@sapphire/plugin-scheduled-tasks/register';

import { SapphireClient } from '@sapphire/framework';
import { LogLevel } from '@sapphire/framework';
import { GatewayIntentBits } from 'discord.js';
import { Shoukaku, Connectors } from 'shoukaku';
import { config } from './config.js';
import { MusicManager } from './lib/music/MusicManager.js';

export class EricaClient extends SapphireClient {
  public override readonly shoukaku: Shoukaku;
  public override readonly music: MusicManager;

  public constructor() {
    super({
      defaultPrefix: '!',
      caseInsensitiveCommands: true,
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
      ],
      logger: {
        level: config.NODE_ENV === 'development' ? LogLevel.Debug : LogLevel.Info,
      },
      loadMessageCommandListeners: true,
      tasks: {
        bull: {
          connection: {
            host: 'localhost',
            port: 6379,
          },
        },
      },
    });

    const lavalinkNodes = [
      {
        name: 'main',
        url: `${config.LAVALINK_HOST}:${config.LAVALINK_PORT}`,
        auth: config.LAVALINK_PASSWORD,
        secure: false,
      },
    ];

    this.shoukaku = new Shoukaku(new Connectors.DiscordJS(this), lavalinkNodes, {
      moveOnDisconnect: false,
      reconnectTries: 3,
      reconnectInterval: 5000,
    });

    this.music = new MusicManager(this.shoukaku);
  }
}

declare module 'discord.js' {
  interface Client {
    readonly shoukaku: Shoukaku;
    readonly music: MusicManager;
  }
}
