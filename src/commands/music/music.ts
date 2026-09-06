import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags } from 'discord.js';
import { errorReply, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Subcommand.Options>({
	name: 'music',
	description: 'Control music playback in your voice channel.',
	subcommands: [
		{ name: 'autoplay', chatInputRun: 'chatInputAutoplay' },
		{ name: 'clearqueue', chatInputRun: 'chatInputClearQueue' },
		{ name: 'filter', chatInputRun: 'chatInputFilter' },
		{ name: 'history', chatInputRun: 'chatInputHistory' },
		{ name: 'leave', chatInputRun: 'chatInputLeave' },
		{ name: 'loop', chatInputRun: 'chatInputLoop' },
		{ name: 'lyrics', chatInputRun: 'chatInputLyrics' },
		{
			name: 'playlist',
			type: 'group',
			entries: [
				{ name: 'save', chatInputRun: 'chatInputPlaylistSave' },
				{ name: 'load', chatInputRun: 'chatInputPlaylistLoad' },
				{ name: 'list', chatInputRun: 'chatInputPlaylistList' },
				{ name: 'view', chatInputRun: 'chatInputPlaylistView' },
				{ name: 'delete', chatInputRun: 'chatInputPlaylistDelete' },
			],
		},
		{ name: 'remove', chatInputRun: 'chatInputRemove' },
		{ name: 'seek', chatInputRun: 'chatInputSeek' },
		{ name: 'setup-music', chatInputRun: 'chatInputSetupMusic' },
		{ name: 'shuffle', chatInputRun: 'chatInputShuffle' },
		{ name: 'tts', chatInputRun: 'chatInputTts' },
		{ name: 'maxvolume', chatInputRun: 'chatInputMaxVolume' },
	],
})
export class MusicCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('music')
				.setDescription('Control music playback in your voice channel.')
				// ── autoplay ───────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('autoplay')
						.setDescription('Toggle NodeLink autoplay — queues similar tracks when the queue ends.')
						.addBooleanOption((o) =>
							o.setName('enabled').setDescription('Turn autoplay on or off (omit to toggle).').setRequired(false),
						),
				)
				// ── clearqueue ─────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('clearqueue').setDescription('Clear the current music queue.'))
				// ── filter ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('filter')
						.setDescription('Apply an audio filter to the playback.')
						.addStringOption((o) =>
							o
								.setName('name')
								.setDescription('The audio filter to apply (omit to clear).')
								.addChoices(
									{ name: 'Clear Filter', value: 'clear' },
									{ name: '8D (Spatial)', value: '8d' },
									{ name: 'Bass Boost', value: 'bassboost' },
									{ name: 'Nightcore (Sped up)', value: 'nightcore' },
									{ name: 'Vaporwave (Slowed)', value: 'vaporwave' },
									{ name: 'Karaoke', value: 'karaoke' },
									{ name: 'Lowpass (Muffled)', value: 'lowpass' },
								)
								.setRequired(false),
						),
				)
				// ── history ────────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('history').setDescription('View recently played tracks in this session.'))
				// ── leave ──────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub.setName('leave').setDescription('Disconnect the bot from the voice channel and clear queue.'),
				)
				// ── loop ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('loop')
						.setDescription('Loop the current track or queue.')
						.addStringOption((o) =>
							o
								.setName('mode')
								.setDescription('Loop mode (omit to toggle).')
								.addChoices(
									{ name: '❌ Off', value: 'none' },
									{ name: '🔂 Track', value: 'track' },
									{ name: '🔁 Queue', value: 'queue' },
								)
								.setRequired(false),
						),
				)
				// ── lyrics ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('lyrics')
						.setDescription('Get lyrics for the currently playing track or search for a track.')
						.addStringOption((o) =>
							o
								.setName('query')
								.setDescription('Search for a track by name/artist.')
								.setAutocomplete(true)
								.setRequired(false),
						),
				)
				// ── playlist ───────────────────────────────────────────────────────────
				.addSubcommandGroup((group) =>
					group
						.setName('playlist')
						.setDescription('Manage your saved personal playlists.')
						.addSubcommand((sub) =>
							sub
								.setName('save')
								.setDescription('Save the current active queue as a playlist.')
								.addStringOption((o) =>
									o.setName('name').setDescription('Name for the playlist.').setMaxLength(50).setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('load')
								.setDescription('Load a saved playlist into the queue.')
								.addStringOption((o) =>
									o.setName('name').setDescription('Name of the playlist to load.').setRequired(true),
								),
						)
						.addSubcommand((sub) => sub.setName('list').setDescription('List your saved playlists.'))
						.addSubcommand((sub) =>
							sub
								.setName('view')
								.setDescription('View the tracks in a saved playlist.')
								.addStringOption((o) =>
									o.setName('name').setDescription('Name of the playlist to view.').setRequired(true),
								),
						)
						.addSubcommand((sub) =>
							sub
								.setName('delete')
								.setDescription('Delete one of your saved playlists.')
								.addStringOption((o) =>
									o.setName('name').setDescription('Name of the playlist to delete.').setRequired(true),
								),
						),
				)
				// ── remove ─────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('remove')
						.setDescription('Remove a track from the queue.')
						.addIntegerOption((o) =>
							o
								.setName('position')
								.setDescription('Queue position of the track to remove.')
								.setMinValue(1)
								.setRequired(true),
						),
				)
				// ── seek ───────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('seek')
						.setDescription('Seek to a specific time in the current track.')
						.addStringOption((o) =>
							o.setName('time').setDescription('Position to seek to (e.g. 1m30s, 45s, 1:30).').setRequired(true),
						),
				)
				// ── setup-music ────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('setup-music')
						.setDescription('Set up or destroy a dedicated music requests channel.')
						.addStringOption((o) =>
							o
								.setName('action')
								.setDescription('Setup action.')
								.setRequired(true)
								.addChoices({ name: 'Setup channel', value: 'setup' }, { name: 'Destroy channel', value: 'destroy' }),
						),
				)
				// ── shuffle ────────────────────────────────────────────────────────────
				.addSubcommand((sub) => sub.setName('shuffle').setDescription('Shuffle the current queue.'))
				// ── tts ────────────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('tts')
						.setDescription('Speak text in your voice channel.')
						.addStringOption((o) =>
							o
								.setName('text')
								.setDescription('The message to speak (max 200 characters).')
								.setMaxLength(200)
								.setRequired(true),
						)
						.addStringOption((o) =>
							o
								.setName('language')
								.setDescription('The language to use (default is server default).')
								.setRequired(false)
								.addChoices(
									{ name: 'English (US)', value: 'en' },
									{ name: 'Spanish', value: 'es' },
									{ name: 'French', value: 'fr' },
									{ name: 'German', value: 'de' },
									{ name: 'Japanese', value: 'ja' },
									{ name: 'Chinese', value: 'zh' },
									{ name: 'Portuguese', value: 'pt' },
									{ name: 'Italian', value: 'it' },
									{ name: 'Russian', value: 'ru' },
									{ name: 'Korean', value: 'ko' },
								),
						),
				)
				// ── maxvolume ──────────────────────────────────────────────────────────
				.addSubcommand((sub) =>
					sub
						.setName('maxvolume')
						.setDescription('Set the maximum music playback volume limit for this server.')
						.addIntegerOption((o) =>
							o
								.setName('level')
								.setDescription('Maximum volume level (0–200). Default is 100.')
								.setMinValue(0)
								.setMaxValue(200)
								.setRequired(true),
						),
				),
		);
	}

	public override async autocompleteRun(interaction: any) {
		const subcommand = interaction.options.getSubcommand(true);
		if (subcommand === 'lyrics') {
			const { LyricsHandler } = await import('../../lib/music/handlers/lyrics.js');
			return new LyricsHandler().autocompleteRun(interaction);
		}
	}

	public async chatInputAutoplay(interaction: Subcommand.ChatInputCommandInteraction) {
		const { AutoPlayHandler } = await import('../../lib/music/handlers/autoplay.js');
		return new AutoPlayHandler().chatInputRun(interaction);
	}

	public async chatInputClearQueue(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ClearQueueHandler } = await import('../../lib/music/handlers/clearqueue.js');
		return new ClearQueueHandler().chatInputRun(interaction);
	}

	public async chatInputFilter(interaction: Subcommand.ChatInputCommandInteraction) {
		const { FilterHandler } = await import('../../lib/music/handlers/filter.js');
		return new FilterHandler().chatInputRun(interaction);
	}

	public async chatInputHistory(interaction: Subcommand.ChatInputCommandInteraction) {
		const { HistoryHandler } = await import('../../lib/music/handlers/history.js');
		return new HistoryHandler().chatInputRun(interaction);
	}

	public async chatInputLeave(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LeaveHandler } = await import('../../lib/music/handlers/leave.js');
		return new LeaveHandler().chatInputRun(interaction);
	}

	public async chatInputLoop(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LoopHandler } = await import('../../lib/music/handlers/loop.js');
		return new LoopHandler().chatInputRun(interaction);
	}

	public async chatInputLyrics(interaction: Subcommand.ChatInputCommandInteraction) {
		const { LyricsHandler } = await import('../../lib/music/handlers/lyrics.js');
		return new LyricsHandler().chatInputRun(interaction);
	}

	// ── playlist subcommands ───────────────────────────────────────────────────────
	public async chatInputPlaylistSave(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PlaylistHandler } = await import('../../lib/music/handlers/playlist.js');
		return new PlaylistHandler().runSave(interaction);
	}

	public async chatInputPlaylistLoad(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PlaylistHandler } = await import('../../lib/music/handlers/playlist.js');
		return new PlaylistHandler().runLoad(interaction);
	}

	public async chatInputPlaylistList(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PlaylistHandler } = await import('../../lib/music/handlers/playlist.js');
		return new PlaylistHandler().runList(interaction);
	}

	public async chatInputPlaylistView(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PlaylistHandler } = await import('../../lib/music/handlers/playlist.js');
		return new PlaylistHandler().runView(interaction);
	}

	public async chatInputPlaylistDelete(interaction: Subcommand.ChatInputCommandInteraction) {
		const { PlaylistHandler } = await import('../../lib/music/handlers/playlist.js');
		return new PlaylistHandler().runDelete(interaction);
	}

	// ── general music subcommands ──────────────────────────────────────────────────

	public async chatInputRemove(interaction: Subcommand.ChatInputCommandInteraction) {
		const { RemoveHandler } = await import('../../lib/music/handlers/remove.js');
		return new RemoveHandler().chatInputRun(interaction);
	}

	public async chatInputSeek(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SeekHandler } = await import('../../lib/music/handlers/seek.js');
		return new SeekHandler().chatInputRun(interaction);
	}

	public async chatInputSetupMusic(interaction: Subcommand.ChatInputCommandInteraction) {
		const { SetupMusicHandler } = await import('../../lib/music/handlers/setup-music.js');
		return new SetupMusicHandler().chatInputRun(interaction);
	}

	public async chatInputShuffle(interaction: Subcommand.ChatInputCommandInteraction) {
		const { ShuffleHandler } = await import('../../lib/music/handlers/shuffle.js');
		return new ShuffleHandler().chatInputRun(interaction);
	}

	public async chatInputTts(interaction: Subcommand.ChatInputCommandInteraction) {
		const { TtsHandler } = await import('../../lib/music/handlers/tts.js');
		return new TtsHandler().chatInputRun(interaction);
	}

	public async chatInputMaxVolume(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const level = interaction.options.getInteger('level', true);
		await db
			.insert(schema.guilds)
			.values({ id: interaction.guildId, maxVolumeLimit: level })
			.onDuplicateKeyUpdate({
				set: { maxVolumeLimit: level },
			});

		return interaction.editReply(successReply(`Maximum volume limit set to **${level}%**.`));
	}
}
