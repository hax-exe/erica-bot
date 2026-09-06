import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, GuildMember, type Interaction, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { ensureAutoplayBuffer, isAutoplayOn, setAutoplay } from '../../lib/AutoplayManager.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import {
	Colors,
	CV2_FLAG,
	cv2Reply,
	errorReply,
	makeContainer,
	meta,
	pageNavRow,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	clearMusicQueue,
	formatDuration,
	inSameVC,
	saveMusicQueue,
	setVoiceChannelStatus,
} from '../../lib/MusicManager.js';
import { buildNpCard, clearNpMessage, npMessages, resetJukeboxUI, updatePlaybackState } from './events.js';

const LOOP_MODES = ['off', 'track', 'queue'] as const;
type LoopMode = (typeof LOOP_MODES)[number];
const LOOP_LABELS: Record<LoopMode, string> = {
	off: 'Loop off',
	track: 'Looping track',
	queue: 'Looping queue',
};

@ApplyOptions<Listener.Options>({
	name: 'musicButtonInteractions',
	event: Events.InteractionCreate,
})
export class MusicButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		try {
			await this.dispatch(interaction);
		} catch (err: any) {
			if (err?.code === 10062 || err?.code === 40060 || err?.code === 10008 || err?.code === 10003) {
				this.container.logger.debug(`[musicButtonInteractions] Interaction discarded (code ${err.code}).`);
				return;
			}
			throw err;
		}
	}

	private async dispatch(interaction: Interaction) {
		let action = '';
		if (interaction.isButton() && interaction.customId.startsWith('music:')) {
			action = interaction.customId;
		} else if (interaction.isStringSelectMenu() && interaction.customId === 'music:options') {
			action = `music:${interaction.values[0]}`;
		} else if (interaction.isModalSubmit() && interaction.customId.startsWith('music:')) {
			action = interaction.customId;
		} else {
			return;
		}

		if (!interaction.inCachedGuild()) return;
		if (!interaction.isMessageComponent() && !interaction.isModalSubmit()) return;

		// Handle Modal popups immediately before deferring
		if (action === 'music:volume_modal') {
			if (!interaction.isStringSelectMenu()) return;
			const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = await import('discord.js');
			const modal = new ModalBuilder().setCustomId('music:volume_submit').setTitle('Set Volume');
			const input = new TextInputBuilder()
				.setCustomId('volume')
				.setLabel('Volume % (0-200)')
				.setStyle(TextInputStyle.Short)
				.setPlaceholder('100')
				.setRequired(true);
			modal.addComponents(new ActionRowBuilder<any>().addComponents(input));
			await interaction.showModal(modal);
			return;
		}

		const isNpMessage =
			interaction.isMessageComponent() && npMessages.get(interaction.guildId)?.id === interaction.message.id;
		const isSelectMenu = interaction.isStringSelectMenu();
		const isModal = interaction.isModalSubmit();

		if (isNpMessage || isSelectMenu || isModal) {
			await interaction.deferUpdate();
		} else {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		}

		async function sendFeedback(replyPayload: import('discord.js').InteractionEditReplyOptions) {
			const i = interaction as import('discord.js').RepliableInteraction;
			// Always keep IsComponentsV2 — overwriting with only Ephemeral causes Discord 50035
			// (components[0] type must be Action Row).
			const flags = ((typeof replyPayload.flags === 'number' ? replyPayload.flags : CV2_FLAG) |
				MessageFlags.Ephemeral) as number;

			// deferUpdate on NP / select / modal — toast via followUp, never replace the public card
			if (isNpMessage || isSelectMenu || isModal) {
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				await i.followUp({ ...replyPayload, flags } as any);
				return;
			}
			// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
			await i.editReply({ ...replyPayload, flags } as any);
		}

		const player = this.container.music.players.get(interaction.guildId);
		if (!player) return sendFeedback(errorReply('Nothing is playing right now.'));

		const member =
			interaction.member instanceof GuildMember
				? interaction.member
				: await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

		if (!inSameVC(player.voiceChannelId, member?.voice.channel?.id)) {
			return sendFeedback(warningReply('You must be in the same voice channel.'));
		}

		async function updateNp() {
			const card = buildNpCard(player!);
			if (!card) return;
			if (isNpMessage && interaction.isMessageComponent()) {
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				await interaction.editReply({ components: [card], flags: CV2_FLAG as any });
			} else {
				const msg = npMessages.get(interaction.guildId!);
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				if (msg) await msg.edit({ components: [card], flags: CV2_FLAG as any }).catch(() => null);
			}
		}

		const actionParts = action.split(':');
		const baseAction = actionParts.slice(0, 2).join(':');
		const actionArg = actionParts[2] ?? '0';

		switch (baseAction) {
			case 'music:volume_submit': {
				if (!interaction.isModalSubmit()) return;
				const volStr = interaction.fields.getTextInputValue('volume');
				const vol = parseInt(volStr, 10);
				if (Number.isNaN(vol) || vol < 0 || vol > 200) {
					return sendFeedback(errorReply('Volume must be a number between 0 and 200.'));
				}

				const guildRow = await db.query.guilds.findFirst({ where: eq(schema.guilds.id, interaction.guildId!) });
				const maxVol = guildRow?.maxVolumeLimit ?? 100;
				const isMod = member && (member.permissions.has('ManageGuild') || member.permissions.has('Administrator'));

				if (vol > maxVol && !isMod) {
					return sendFeedback(
						warningReply(
							`The volume limit on this server is set to **${maxVol}%**. Only moderators can exceed this limit.`,
						),
					);
				}

				player.setVolume(vol);
				await updateNp();
				await saveMusicQueue(player);
				return sendFeedback(successReply(`Volume set to **${vol}%**.`));
			}
			case 'music:pause': // idle jukebox panel uses music:pause
			case 'music:toggle': {
				if (player.paused) {
					player.resume();
				} else {
					player.pause();
				}
				await updatePlaybackState(player);
				await saveMusicQueue(player);

				if (player.voiceChannelId && player.current) {
					const status = player.paused
						? `Paused — ${player.current.title}`
						: player.current.author
							? `${player.current.title} — ${player.current.author}`
							: (player.current.title ?? '');
					await setVoiceChannelStatus(this.container.client, player.voiceChannelId, status);
				}
				return sendFeedback(successReply(player.paused ? 'Paused.' : 'Resumed.', true));
			}
			case 'music:skip': {
				const title = player.current?.title ?? 'the current track';
				const seed = player.current;
				if (isAutoplayOn(interaction.guildId) && player.queue.size < 1) {
					await ensureAutoplayBuffer(player, seed).catch(() => 0);
				}
				await player.skip().catch(() => null);
				if (isAutoplayOn(interaction.guildId)) {
					void ensureAutoplayBuffer(player, seed).catch(() => null);
				}
				return sendFeedback(successReply(`Skipped **${title}**.`, true));
			}
			case 'music:loop': {
				const current = (player.loop as LoopMode) ?? 'off';
				const next = LOOP_MODES[(LOOP_MODES.indexOf(current) + 1) % LOOP_MODES.length];
				player.setLoop(next);
				await updatePlaybackState(player);
				await saveMusicQueue(player);
				return sendFeedback(successReply(`${LOOP_LABELS[next]}.`, true));
			}
			case 'music:autoplay': {
				const next = !isAutoplayOn(interaction.guildId);
				setAutoplay(interaction.guildId, next, player);
				await updatePlaybackState(player);
				return sendFeedback(successReply(next ? 'Autoplay enabled.' : 'Autoplay disabled.', true));
			}
			case 'music:stop': {
				const vcId = player.voiceChannelId;
				if (vcId) await setVoiceChannelStatus(this.container.client, vcId, null).catch(() => null);
				await player.destroy().catch(() => null);
				await clearMusicQueue(interaction.guildId).catch(() => null);
				clearNpMessage(interaction.guildId);
				await resetJukeboxUI(interaction.guildId);
				return sendFeedback(successReply('Stopped and cleared the queue.'));
			}
			case 'music:clear_queue': {
				player.queue.clear();
				await saveMusicQueue(player);
				return sendFeedback(successReply('Cleared all upcoming tracks from the queue.'));
			}
			case 'music:shuffle': {
				if (!player.queue.size) return sendFeedback(warningReply('The queue is empty — nothing to shuffle.'));
				player.queue.shuffle();
				await saveMusicQueue(player);
				return sendFeedback(successReply('Queue shuffled.'));
			}
			case 'music:previous': {
				if (!player.current) return sendFeedback(errorReply('Nothing is playing right now.'));
				if (!player.current.isSeekable)
					return sendFeedback(warningReply("This track can't be restarted (live stream)."));
				player.seek(0).catch(() => null);
				return sendFeedback(successReply('Restarted current track.'));
			}
			case 'music:filter_bassboost': {
				player.filters.setEqualizer([
					{ band: 0, gain: 0.2 },
					{ band: 1, gain: 0.15 },
					{ band: 2, gain: 0.1 },
				]);
				await updateNp();
				return sendFeedback(successReply('Bassboost filter enabled.'));
			}
			case 'music:filter_nightcore': {
				player.filters.setTimescale({ speed: 1.2, pitch: 1.2, rate: 1.0 });
				await updateNp();
				return sendFeedback(successReply('Nightcore filter enabled.'));
			}
			case 'music:filter_vaporwave': {
				player.filters.setTimescale({ speed: 0.85, pitch: 0.8, rate: 1.0 });
				await updateNp();
				return sendFeedback(successReply('Vaporwave filter enabled.'));
			}
			case 'music:filter_clear': {
				player.filters.clear();
				await updateNp();
				return sendFeedback(successReply('Audio filters cleared.'));
			}
			case 'music:queue': {
				const tracks = player.queue.tracks ?? [];
				const current = player.current;
				const lines: string[] = [];
				if (current) {
					const dur = current.isStream ? 'LIVE' : formatDuration(current.duration ?? 0);
					const label = player.paused ? 'Paused' : 'Now Playing';
					lines.push(`**${label}**\n[${current.title}](${current.uri}) — \`${dur}\``);
				}

				const PAGE_SIZE = 10;
				let page = parseInt(actionArg, 10);
				if (Number.isNaN(page) || page < 0) page = 0;

				const totalPages = Math.ceil(tracks.length / PAGE_SIZE) || 1;
				if (page >= totalPages) page = totalPages - 1;

				const slice = (tracks as Array<{ title?: string; uri?: string; duration?: number; isStream?: boolean }>).slice(
					page * PAGE_SIZE,
					(page + 1) * PAGE_SIZE,
				);

				if (slice.length > 0) {
					lines.push('');
					lines.push(`**Up next (page ${page + 1}/${totalPages})**`);
					for (const [i, t] of slice.entries()) {
						const dur = t.isStream ? 'LIVE' : formatDuration(t.duration ?? 0);
						lines.push(`\`${page * PAGE_SIZE + i + 1}.\` [${t.title}](${t.uri}) — \`${dur}\``);
					}
				} else if (!current) {
					lines.push('The queue is empty.');
				}

				if (tracks.length > 0 || current) {
					const queueMs = (tracks as Array<{ duration?: number }>).reduce((acc, t) => acc + (t.duration ?? 0), 0);
					const currentMs = !current?.isStream && current?.duration ? current.duration - (current.position ?? 0) : 0;
					lines.push('');
					lines.push(
						`-# ${tracks.length} track${tracks.length === 1 ? '' : 's'} queued · ${formatDuration(queueMs + currentMs)} remaining`,
					);
				}

				const statusBits: string[] = [];
				if (player.loop === 'track') statusBits.push('Loop: Track');
				else if (player.loop === 'queue') statusBits.push('Loop: Queue');
				if (isAutoplayOn(interaction.guildId)) statusBits.push('Autoplay');

				const container = makeContainer({ color: Colors.Voice, header: `Queue` });
				if (statusBits.length > 0) {
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta(...statusBits)));
				}
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

				if (totalPages > 1) {
					container.addActionRowComponents(
						pageNavRow(`music:queue:${page - 1}`, `music:queue:${page + 1}`, {
							atStart: page === 0,
							atEnd: page === totalPages - 1,
						}),
					);
				}

				return sendFeedback(cv2Reply(container, true));
			}
			default:
				return sendFeedback(errorReply('Unknown music action.'));
		}
	}
}
