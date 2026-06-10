import { Shoukaku, type Player } from 'shoukaku';
import { Queue } from './Queue.js';
import { container } from '@sapphire/framework';

export class MusicManager {
  public readonly shoukaku: Shoukaku;
  public readonly queues: Map<string, Queue>;

  public constructor(shoukaku: Shoukaku) {
    this.shoukaku = shoukaku;
    this.queues = new Map();

    this.registerNodeEvents();
  }

  /**
   * Retrieves the queue for a guild, or undefined if none exists.
   */
  public getQueue(guildId: string): Queue | undefined {
    return this.queues.get(guildId);
  }

  /**
   * Creates a new queue for a guild, connecting to the specified voice channel.
   * If a queue already exists for the guild, it is returned instead.
   */
  public async createQueue(
    guildId: string,
    textChannelId: string,
    voiceChannelId: string,
  ): Promise<Queue> {
    const existing = this.queues.get(guildId);
    if (existing) return existing;

    const player = await this.shoukaku.joinVoiceChannel({
      guildId,
      channelId: voiceChannelId,
      shardId: 0,
      deaf: true,
    });

    const queue = new Queue(guildId, textChannelId, voiceChannelId, player);
    this.queues.set(guildId, queue);

    this.registerPlayerEvents(player, guildId);

    return queue;
  }

  /**
   * Destroys a guild's queue and disconnects from the voice channel.
   */
  public destroyQueue(guildId: string): void {
    const queue = this.queues.get(guildId);
    if (!queue) return;

    queue.tracks = [];
    queue.current = null;

    this.shoukaku.leaveVoiceChannel(guildId);
    this.queues.delete(guildId);
  }

  /**
   * Registers event handlers on Shoukaku node lifecycle events.
   */
  private registerNodeEvents(): void {
    this.shoukaku.on('ready', (name: string) => {
      container.logger.info(`[Music] Lavalink node "${name}" is ready.`);
    });

    this.shoukaku.on('error', (name: string, error: Error) => {
      container.logger.error(`[Music] Lavalink node "${name}" encountered an error:`, error);
    });

    this.shoukaku.on('disconnect', (name: string, count: number) => {
      container.logger.warn(
        `[Music] Lavalink node "${name}" disconnected. ${count} players affected.`,
      );
    });

    this.shoukaku.on('close', (name: string, code: number, reason: string) => {
      container.logger.warn(
        `[Music] Lavalink node "${name}" closed. Code: ${code}, Reason: ${reason || 'none'}`,
      );
    });
  }

  /**
   * Registers event handlers on a Shoukaku player for track lifecycle management.
   */
  private registerPlayerEvents(player: Player, guildId: string): void {
    player.on('end', () => {
      const queue = this.queues.get(guildId);
      if (!queue) return;

      const next = queue.skip();
      if (!next) {
        this.destroyQueue(guildId);
        return;
      }

      player.playTrack({ track: { encoded: next.url } });
    });

    player.on('stuck', () => {
      container.logger.warn(`[Music] Player stuck in guild ${guildId}. Skipping track.`);
      const queue = this.queues.get(guildId);
      if (!queue) return;

      const next = queue.skip();
      if (!next) {
        this.destroyQueue(guildId);
        return;
      }

      player.playTrack({ track: { encoded: next.url } });
    });

    player.on('exception', (error) => {
      container.logger.error(`[Music] Player exception in guild ${guildId}:`, error);
    });

    player.on('closed', () => {
      this.destroyQueue(guildId);
    });
  }
}
