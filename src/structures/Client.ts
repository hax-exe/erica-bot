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
            if (!channel?.isTextBased() || !('send' in channel)) return;

            // Set voice channel status to show current song using REST API
            try {
                const voiceChannelId = player.voiceId;
                if (voiceChannelId) {
                    const statusText = track.title.slice(0, 500);
                    const rest = new REST().setToken(config.discord.token);
                    await rest.put(`/channels/${voiceChannelId}/voice-status` as any, {
                        body: { status: statusText },
                    });
                }
            } catch (error) {
                logger.debug({ error }, 'Could not set voice channel status');
            }

            try {
                // Import utilities dynamically to avoid circular dependencies
                const { createNowPlayingMessage } = await import('../utils/musicPlayer.js');
                const { getRecommendations } = await import('../utils/recommendations.js');

                // Fetch recommendations based on current track (tries Spotify first, then YouTube)
                const suggestions = await getRecommendations(
                    this.music,
                    track.uri || '',
                    track.title,
                    track.author || 'Unknown'
                );

                // Create and send the interactive Now Playing message
                const { embed, components } = createNowPlayingMessage(player, track, suggestions);
                const msg = await channel.send({ embeds: [embed], components: components as any });

                // Store message ID for later updates/cleanup
                player.data.set('nowPlayingMessageId', msg.id);
                player.data.set('nowPlayingChannelId', channel.id);

                // Store suggestions for when user selects one
                if (suggestions.length > 0) {
                    player.data.set('suggestions', suggestions);
                }
            } catch (error) {
                logger.error({ error }, 'Failed to send interactive Now Playing message');
                // Fallback to simple message
                channel.send(`🎵 Now playing: **${track.title}** by **${track.author}**`);
            }
        });

        this.music.on('playerEnd', async (player) => {
            // Save current track to history before it ends
            const currentTrack = player.queue.current;
            if (currentTrack) {
                // Get existing history or create new array
                const history = (player.data.get('trackHistory') as any[]) || [];

                // Add to history (keep last 10 tracks)
                history.unshift({
                    title: currentTrack.title,
                    author: currentTrack.author,
                    uri: currentTrack.uri,
                    thumbnail: currentTrack.thumbnail,
                });

                // Limit history size
                if (history.length > 10) {
                    history.pop();
                }

                player.data.set('trackHistory', history);
                player.data.set('previousTrack', history[0]);
            }

            // Delete the old Now Playing message when track ends
            try {
                const messageId = player.data.get('nowPlayingMessageId') as string | undefined;
                const channelId = player.data.get('nowPlayingChannelId') as string | undefined;

                if (messageId && channelId) {
                    const channel = this.channels.cache.get(channelId);
                    if (channel?.isTextBased() && 'messages' in channel) {
                        const msg = await channel.messages.fetch(messageId).catch(() => null);
                        if (msg?.deletable) {
                            await msg.delete().catch(() => { });
                        }
                    }
                }
            } catch {
                // Ignore errors when cleaning up messages
            }
        });

        this.music.on('playerEmpty', async (player) => {
            // Clear voice channel status using REST API
            try {
                const voiceChannelId = player.voiceId;
                if (voiceChannelId) {
                    const rest = new REST().setToken(config.discord.token);
                    await rest.put(`/channels/${voiceChannelId}/voice-status` as any, {
                        body: { status: null },
                    });
                }
            } catch {
                // Ignore errors
            }

            const channel = this.channels.cache.get(player.textId!);
            if (channel?.isTextBased() && 'send' in channel) {
                channel.send('📭 Queue is empty. Disconnecting...');
            }

            player.destroy();
        });

        this.music.on('playerDestroy', async (player) => {
            // Clean up the Now Playing message when player is destroyed
            try {
                const messageId = player.data.get('nowPlayingMessageId') as string | undefined;
                const channelId = player.data.get('nowPlayingChannelId') as string | undefined;

                if (messageId && channelId) {
                    const channel = this.channels.cache.get(channelId);
                    if (channel?.isTextBased() && 'messages' in channel) {
                        const msg = await channel.messages.fetch(messageId).catch(() => null);
                        if (msg?.deletable) {
                            await msg.delete().catch(() => { });
                        }
                    }
                }
            } catch {
                // Ignore errors when cleaning up messages
            }

            // Clear voice channel status using REST API
            try {
                const voiceChannelId = player.voiceId;
                if (voiceChannelId) {
                    const rest = new REST().setToken(config.discord.token);
                    await rest.put(`/channels/${voiceChannelId}/voice-status` as any, {
                        body: { status: null },
                    });
                }
            } catch {
                // Ignore errors
            }
        });
    }

    async deployCommands(): Promise<void> {
        const rest = new REST().setToken(config.discord.token);
        const commands = this.commands.map((cmd) => cmd.data.toJSON());

        // Run deployment in background to not block bot startup
        const deployAsync = async () => {
            try {
                logger.info(`Deploying ${commands.length} slash commands...`);
                logger.info({ isDev: config.bot.isDev, devGuildId: config.discord.devGuildId }, 'Deployment config');

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
            }
        };

        // Fire and forget - don't block startup
        deployAsync();
    }

    async start(): Promise<void> {
        await this.login(config.discord.token);
    }
}
