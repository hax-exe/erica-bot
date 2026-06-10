import type { User } from 'discord.js';
import type { Player } from 'shoukaku';

export enum LoopMode {
  Off = 'off',
  Track = 'track',
  Queue = 'queue',
}

export interface Track {
  title: string;
  url: string;
  duration: number;
  author: string;
  requester: User;
  thumbnail: string | null;
}

export class Queue {
  public readonly guildId: string;
  public readonly textChannelId: string;
  public readonly voiceChannelId: string;
  public tracks: Track[];
  public current: Track | null;
  public loop: LoopMode;
  public volume: number;
  public player: Player;

  public constructor(
    guildId: string,
    textChannelId: string,
    voiceChannelId: string,
    player: Player,
  ) {
    this.guildId = guildId;
    this.textChannelId = textChannelId;
    this.voiceChannelId = voiceChannelId;
    this.tracks = [];
    this.current = null;
    this.loop = LoopMode.Off;
    this.volume = 100;
    this.player = player;
  }

  /**
   * Adds a track to the end of the queue.
   */
  public add(track: Track): void {
    this.tracks.push(track);
  }

  /**
   * Skips the current track and returns the next track, or null if none remain.
   * Respects loop modes: Track loops replay the current track, Queue loops
   * push the current track to the end before shifting the next one.
   */
  public skip(): Track | null {
    if (this.loop === LoopMode.Track && this.current) {
      return this.current;
    }

    if (this.loop === LoopMode.Queue && this.current) {
      this.tracks.push(this.current);
    }

    this.current = this.tracks.shift() ?? null;
    return this.current;
  }

  /**
   * Clears all queued tracks (does not affect the currently playing track).
   */
  public clear(): void {
    this.tracks = [];
  }

  /**
   * Shuffles the queued tracks using the Fisher-Yates algorithm.
   */
  public shuffle(): void {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const temp = this.tracks[i]!;
      this.tracks[i] = this.tracks[j]!;
      this.tracks[j] = temp;
    }
  }

  /**
   * Removes a track at the given index. Returns the removed track or null if index is invalid.
   */
  public remove(index: number): Track | null {
    if (index < 0 || index >= this.tracks.length) return null;
    const [removed] = this.tracks.splice(index, 1);
    return removed ?? null;
  }

  /**
   * Cycles the loop mode: Off → Track → Queue → Off.
   */
  public setLoop(mode?: LoopMode): LoopMode {
    if (mode !== undefined) {
      this.loop = mode;
      return this.loop;
    }

    switch (this.loop) {
      case LoopMode.Off:
        this.loop = LoopMode.Track;
        break;
      case LoopMode.Track:
        this.loop = LoopMode.Queue;
        break;
      case LoopMode.Queue:
        this.loop = LoopMode.Off;
        break;
    }

    return this.loop;
  }

  /**
   * Sets the player volume (0–200). Clamps out-of-range values.
   */
  public async setVolume(volume: number): Promise<void> {
    this.volume = Math.max(0, Math.min(200, volume));
    await this.player.setGlobalVolume(this.volume);
  }

  /**
   * Returns the total duration of all queued tracks in milliseconds.
   */
  public get totalDuration(): number {
    return this.tracks.reduce((acc, track) => acc + track.duration, 0);
  }

  /**
   * Returns the number of tracks in the queue (excluding the current track).
   */
  public get size(): number {
    return this.tracks.length;
  }
}
