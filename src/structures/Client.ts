import {
    Client,
    GatewayIntentBits,
    Partials,
    Collection,
    REST,
    Routes,
} from 'discord.js';
import { Kazagumo, Plugins } from 'kazagumo';
import { Connectors } from 'shoukaku';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { Command } from '../types/Command.js';

const logger = createLogger('client');

export class ExtendedClient extends Client {
    public commands: Collection<string, Command> = new Collection();
    public cooldowns: Collection<string, Collection<string, number>> = new Collection();
    public music: Kazagumo;

    constructor() {
        super({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages,
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction,
                Partials.User,
                Partials.GuildMember,
            ],
            allowedMentions: {
                parse: ['users', 'roles'],
                repliedUser: true,
            },
        });

        // Initialize Kazagumo (Lavalink wrapper)
        this.music = new Kazagumo(
            {
                defaultSearchEngine: 'youtube',
                plugins: [
                    new Plugins.PlayerMoved(this),
                ],
                send: (guildId, payload) => {
                    const guild = this.guilds.cache.get(guildId);
                    if (guild) guild.shard.send(payload);
                },
            },
            new Connectors.DiscordJS(this),
            [
                {
                    name: 'main',
                    url: `${config.lavalink.host}:${config.lavalink.port}`,
                    auth: config.lavalink.password,
                    secure: false,
                },
            ]
        );

        this.setupMusicEvents();
    }

    private setupMusicEvents(): void {
        this.music.shoukaku.on('ready', (name) => {
            logger.info(`Lavalink node "${name}" connected`);
        });

        this.music.shoukaku.on('error', (name, error) => {
            logger.error({ error }, `Lavalink node "${name}" error`);
        });

        this.music.shoukaku.on('close', (name, code, reason) => {
            logger.warn({ code, reason }, `Lavalink node "${name}" disconnected`);
        });

        this.music.on('playerStart', async (player, track) => {
            const channel = this.channels.cache.get(player.textId!);
            if (channel?.isTextBased() && 'send' in channel) {
                channel.send(`🎵 Now playing: **${track.title}** by **${track.author}**`);
            }

            // Start auto-saving player state for HA failover
            if (config.ha.enabled) {
                const { startAutoSave, savePlayerState } = await import('../services/playerState.js');
                startAutoSave(player);
                // Save immediately when track starts
                await savePlayerState(player);
            }
        });

        this.music.on('playerEnd', async (player) => {
            if (!player.queue.length) {
                const channel = this.channels.cache.get(player.textId!);
                if (channel?.isTextBased() && 'send' in channel) {
                    channel.send('📭 Queue is empty. Disconnecting...');
                }

                // Stop auto-save and clean up state
                if (config.ha.enabled) {
                    const { stopAutoSave, deletePlayerState } = await import('../services/playerState.js');
                    stopAutoSave(player.guildId);
                    await deletePlayerState(player.guildId);
                }

                player.destroy();
            }
        });

        this.music.on('playerEmpty', async (player) => {
            const channel = this.channels.cache.get(player.textId!);
            if (channel?.isTextBased() && 'send' in channel) {
                channel.send('📭 Queue is empty. Disconnecting...');
            }

            // Stop auto-save and clean up state
            if (config.ha.enabled) {
                const { stopAutoSave, deletePlayerState } = await import('../services/playerState.js');
                stopAutoSave(player.guildId);
                await deletePlayerState(player.guildId);
            }

            player.destroy();
        });
    }

    async deployCommands(): Promise<void> {
        const rest = new REST().setToken(config.discord.token);
        const commands = this.commands.map((cmd) => cmd.data.toJSON());

        try {
            logger.info(`Deploying ${commands.length} slash commands...`);

            if (config.bot.isDev && config.discord.devGuildId) {
                // Deploy to dev guild for faster updates
                await rest.put(
                    Routes.applicationGuildCommands(config.discord.clientId, config.discord.devGuildId),
                    { body: commands }
                );
                logger.info(`Deployed ${commands.length} commands to dev guild`);
            } else {
                // Deploy globally
                await rest.put(
                    Routes.applicationCommands(config.discord.clientId),
                    { body: commands }
                );
                logger.info(`Deployed ${commands.length} commands globally`);
            }
        } catch (error) {
            logger.error({ error }, 'Failed to deploy commands');
            throw error;
        }
    }

    async start(): Promise<void> {
        await this.login(config.discord.token);
    }
}
