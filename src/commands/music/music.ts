import { Subcommand } from '@sapphire/plugin-subcommands';

import { EricaEmbed } from '../../lib/utils/embed.js';
import { Paginator } from '../../lib/utils/paginator.js';
import { formatDuration } from '../../lib/utils/time.js';

const FILTER_PRESETS: Record<string, Record<string, unknown>> = {
  bassboost: {
    equalizer: [
      { band: 0, gain: 0.6 },
      { band: 1, gain: 0.67 },
      { band: 2, gain: 0.67 },
      { band: 3, gain: 0.4 },
      { band: 4, gain: -0.5 },
      { band: 5, gain: 0.15 },
      { band: 6, gain: -0.45 },
      { band: 7, gain: 0.23 },
      { band: 8, gain: 0.35 },
      { band: 9, gain: 0.45 },
      { band: 10, gain: 0.55 },
      { band: 11, gain: 0.6 },
      { band: 12, gain: 0.55 },
      { band: 13, gain: 0 }
    ]
  },
  nightcore: {
    timescale: { speed: 1.3, pitch: 1.3, rate: 1.0 }
  },
  vaporwave: {
    timescale: { speed: 0.85, pitch: 0.8, rate: 1.0 },
    equalizer: [
      { band: 0, gain: 0.3 },
      { band: 1, gain: 0.3 }
    ]
  },
  '8d': {
    rotation: { rotationHz: 0.2 }
  },
  karaoke: {
    karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }
  },
  tremolo: {
    tremolo: { frequency: 4.0, depth: 0.75 }
  },
  vibrato: {
    vibrato: { frequency: 4.0, depth: 0.75 }
  },
  reset: {}
};

const FILTER_NAMES = Object.keys(FILTER_PRESETS);

const LOOP_MODES = ['off', 'track', 'queue'] as const;

export class MusicCommand extends Subcommand {
  public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
    super(context, {
      ...options,
      name: 'music',
      description: 'Music commands',
      subcommands: [
        { name: 'play', chatInputRun: 'chatInputPlay' },
        { name: 'skip', chatInputRun: 'chatInputSkip' },
        { name: 'stop', chatInputRun: 'chatInputStop' },
        { name: 'pause', chatInputRun: 'chatInputPause' },
        { name: 'resume', chatInputRun: 'chatInputResume' },
        { name: 'queue', chatInputRun: 'chatInputQueue' },
        { name: 'nowplaying', chatInputRun: 'chatInputNowPlaying' },
        { name: 'volume', chatInputRun: 'chatInputVolume' },
        { name: 'loop', chatInputRun: 'chatInputLoop' },
        { name: 'filter', chatInputRun: 'chatInputFilter' }
      ]
    });
  }

  public override registerApplicationCommands(registry: Subcommand.Registry) {
    registry.registerChatInputCommand((builder) =>
      builder
        .setName('music')
        .setDescription('Music commands')
        .setDMPermission(false)
        .addSubcommand((sub) =>
          sub
            .setName('play')
            .setDescription('Play a song or add it to the queue')
            .addStringOption((opt) => opt.setName('query').setDescription('Song name or URL').setRequired(true))
        )
        .addSubcommand((sub) => sub.setName('skip').setDescription('Skip the current track'))
        .addSubcommand((sub) => sub.setName('stop').setDescription('Stop playback and disconnect'))
        .addSubcommand((sub) => sub.setName('pause').setDescription('Pause the current track'))
        .addSubcommand((sub) => sub.setName('resume').setDescription('Resume the current track'))
        .addSubcommand((sub) => sub.setName('queue').setDescription('View the current queue'))
        .addSubcommand((sub) => sub.setName('nowplaying').setDescription('Show the currently playing track'))
        .addSubcommand((sub) =>
          sub
            .setName('volume')
            .setDescription('Set the playback volume')
            .addIntegerOption((opt) => opt.setName('level').setDescription('Volume level (0-100)').setRequired(true).setMinValue(0).setMaxValue(100))
        )
        .addSubcommand((sub) => sub.setName('loop').setDescription('Cycle loop mode: off → track → queue'))
        .addSubcommand((sub) =>
          sub
            .setName('filter')
            .setDescription('Apply an audio filter preset')
            .addStringOption((opt) =>
              opt
                .setName('preset')
                .setDescription('The filter preset to apply')
                .setRequired(true)
                .addChoices(...FILTER_NAMES.map((name) => ({ name, value: name })))
            )
        )
    );
  }

  private get music() {
    return (this.container.client as any).music;
  }

  public async chatInputPlay(interaction: Subcommand.ChatInputCommandInteraction) {
    const member = interaction.member as any;
    const voiceChannel = member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        embeds: [EricaEmbed.error().setDescription('You need to be in a voice channel to use this command.')],
        ephemeral: true
      });
    }

    await interaction.deferReply();

    const query = interaction.options.getString('query', true);
    const node = this.music.shoukaku.nodes.values().next().value;

    if (!node) {
      return interaction.editReply({ embeds: [EricaEmbed.error().setDescription('No available audio nodes. Please try again later.')] });
    }

    const result = await node.rest.resolve(`ytsearch:${query.startsWith('http') ? query : query}`);

    if (!result?.data || (Array.isArray(result.data) && result.data.length === 0)) {
      return interaction.editReply({ embeds: [EricaEmbed.error().setDescription(`No results found for **${query}**.`)] });
    }

    const track = Array.isArray(result.data) ? result.data[0] : result.data;
    const trackInfo = {
      title: track.info.title,
      uri: track.info.uri,
      duration: track.info.length,
      author: track.info.author,
      requester: interaction.user,
      encoded: track.encoded
    };

    let queue = this.music.getQueue(interaction.guildId!);

    if (!queue) {
      queue = await this.music.createQueue(interaction.guildId!, interaction.channelId, voiceChannel.id);
    }

    queue.add(trackInfo);

    const embed = EricaEmbed.success()
      .setTitle('Track Enqueued')
      .setDescription(`[**${trackInfo.title}**](${trackInfo.uri})`)
      .addFields(
        { name: 'Author', value: trackInfo.author, inline: true },
        { name: 'Duration', value: formatDuration(trackInfo.duration), inline: true },
        { name: 'Position', value: queue.tracks.length === 0 ? 'Now Playing' : `#${queue.tracks.length}`, inline: true }
      )
      .setThumbnail(`https://img.youtube.com/vi/${this.extractVideoId(trackInfo.uri)}/hqdefault.jpg`);

    return interaction.editReply({ embeds: [embed] });
  }

  public async chatInputSkip(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    const skippedTitle = queue.current.title;
    queue.skip();

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription(`⏭ Skipped **${skippedTitle}**.`)]
    });
  }

  public async chatInputStop(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    this.music.destroyQueue(interaction.guildId!);

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription('⏹ Stopped playback and disconnected.')]
    });
  }

  public async chatInputPause(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    queue.player.setPaused(true);

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription('⏸ Paused the current track.')]
    });
  }

  public async chatInputResume(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    queue.player.setPaused(false);

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription('▶️ Resumed the current track.')]
    });
  }

  public async chatInputQueue(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || (!queue.current && queue.tracks.length === 0)) {
      return interaction.reply({ embeds: [EricaEmbed.info().setDescription('The queue is empty.')], ephemeral: true });
    }

    const itemsPerPage = 10;
    const tracks = queue.tracks;
    const pages: EricaEmbed[] = [];

    const nowPlaying = queue.current
      ? `🎶 **Now Playing:** [${queue.current.title}](${queue.current.uri}) — ${formatDuration(queue.current.duration)}\nRequested by ${queue.current.requester}\n\n`
      : '';

    if (tracks.length === 0) {
      const embed = new EricaEmbed()
        .setTitle('Music Queue')
        .setDescription(`${nowPlaying}No upcoming tracks in the queue.`)
        .setFooter({ text: `Loop: ${queue.loop} • Volume: ${queue.volume}%` });
      pages.push(embed);
    } else {
      for (let i = 0; i < tracks.length; i += itemsPerPage) {
        const pageTracks = tracks.slice(i, i + itemsPerPage);
        const description =
          (i === 0 ? nowPlaying : '') +
          '**Up Next:**\n' +
          pageTracks
            .map((track: any, idx: number) => `\`${i + idx + 1}.\` [${track.title}](${track.uri}) — ${formatDuration(track.duration)} (${track.requester})`)
            .join('\n');

        const embed = new EricaEmbed()
          .setTitle('Music Queue')
          .setDescription(description)
          .setFooter({
            text: `Page ${Math.floor(i / itemsPerPage) + 1} of ${Math.ceil(tracks.length / itemsPerPage)} • ${tracks.length} tracks • Loop: ${queue.loop} • Volume: ${queue.volume}%`
          });

        pages.push(embed);
      }
    }

    const paginator = new Paginator(pages);
    return paginator.send(interaction);
  }

  public async chatInputNowPlaying(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.info().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    const track = queue.current;
    const position = queue.player.position;
    const duration = track.duration;
    const progress = this.createProgressBar(position, duration);

    const embed = new EricaEmbed()
      .setTitle('Now Playing')
      .setDescription(`[**${track.title}**](${track.uri})`)
      .addFields(
        { name: 'Author', value: track.author, inline: true },
        { name: 'Requested By', value: `${track.requester}`, inline: true },
        { name: 'Volume', value: `${queue.volume}%`, inline: true },
        { name: 'Progress', value: `${formatDuration(position)} ${progress} ${formatDuration(duration)}`, inline: false }
      )
      .setThumbnail(`https://img.youtube.com/vi/${this.extractVideoId(track.uri)}/hqdefault.jpg`);

    return interaction.reply({ embeds: [embed] });
  }

  public async chatInputVolume(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    const level = interaction.options.getInteger('level', true);
    queue.setVolume(level);

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription(`🔊 Volume set to **${level}%**.`)]
    });
  }

  public async chatInputLoop(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    const currentIndex = LOOP_MODES.indexOf(queue.loop as (typeof LOOP_MODES)[number]);
    const nextMode = LOOP_MODES[(currentIndex + 1) % LOOP_MODES.length]!;
    queue.setLoop(nextMode);

    const modeEmojis: Record<string, string> = {
      off: '▶️ Loop disabled',
      track: '🔂 Looping current track',
      queue: '🔁 Looping the entire queue'
    };

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription(modeEmojis[nextMode]!)]
    });
  }

  public async chatInputFilter(interaction: Subcommand.ChatInputCommandInteraction) {
    const queue = this.music.getQueue(interaction.guildId!);

    if (!queue || !queue.current) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('There is nothing playing right now.')], ephemeral: true });
    }

    const preset = interaction.options.getString('preset', true);
    const filterOptions = FILTER_PRESETS[preset];

    if (!filterOptions) {
      return interaction.reply({ embeds: [EricaEmbed.error().setDescription('Invalid filter preset.')], ephemeral: true });
    }

    await queue.player.setGlobalVolume(queue.volume);
    await queue.player.setFilterVolume(1.0);

    if (preset === 'reset') {
      await queue.player.clearFilters();
      return interaction.reply({
        embeds: [EricaEmbed.success().setDescription('🎛️ Filters have been reset.')]
      });
    }

    await queue.player.setFilters(filterOptions);

    return interaction.reply({
      embeds: [EricaEmbed.success().setDescription(`🎛️ Applied the **${preset}** filter preset.`)]
    });
  }

  private createProgressBar(current: number, total: number, length = 15): string {
    const progress = Math.round((current / total) * length);

    const filledBar = '▬'.repeat(progress);
    const remaining = '▬'.repeat(length - progress);
    return `${filledBar}🔘${remaining}`;
  }

  private extractVideoId(uri: string): string {
    const match = uri?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match?.[1] ?? '';
  }
}
