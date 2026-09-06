import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type VoiceState } from 'discord.js';
import { addVoiceXp, getLevelRoles, getOrCreateLevelSettings, type LevelSettingsRow } from '../../lib/LevelingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// ─── In-memory session tracking ───────────────────────────────────────────────

/** Maps "guildId:userId" → timestamp (ms) when the eligible session started. */
const voiceJoinTimestamps = new Map<string, number>();

// ─── Listener ─────────────────────────────────────────────────────────────────

@ApplyOptions<Listener.Options>({
	name: 'levelingVoiceStateUpdate',
	event: Events.VoiceStateUpdate,
})
export class LevelingVoiceListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override async run(oldState: VoiceState, newState: VoiceState) {
		const member = newState.member ?? oldState.member;
		if (!member || member.user.bot) return;

		const guildId = newState.guild.id;
		if (!(await isModuleEnabled(guildId, 'leveling'))) return;
		const userId = member.id;
		const key = `${guildId}:${userId}`;

		const settings = await getOrCreateLevelSettings(guildId);
		if (!settings.enabled || !settings.voiceXpEnabled) {
			voiceJoinTimestamps.delete(key);
			return;
		}

		const noXpVoice = JSON.parse(settings.noXpVoiceChannelIds) as string[];
		const afkChannelId = newState.guild.afkChannelId;

		/** A voice state is eligible for XP if it's in a real, non-excluded channel and not deafened. */
		const isEligible = (state: VoiceState): boolean => {
			if (!state.channelId) return false;
			if (state.channelId === afkChannelId) return false;
			if (state.selfDeaf || state.serverDeaf) return false;
			if (noXpVoice.includes(state.channelId)) return false;
			return true;
		};

		const wasEligible = isEligible(oldState);
		const nowEligible = isEligible(newState);

		// ── Started earning XP ────────────────────────────────────────────────────
		if (!wasEligible && nowEligible) {
			const channel = newState.channel;
			if (channel) {
				const humans = channel.members.filter((m) => !m.user.bot).size;
				if (humans >= settings.voiceMinMembers) {
					voiceJoinTimestamps.set(key, Date.now());
				}
			}
			return;
		}

		// ── Stopped earning XP (left VC, muted, moved to AFK) ────────────────────
		if (wasEligible && !nowEligible) {
			const joinedAt = voiceJoinTimestamps.get(key);
			voiceJoinTimestamps.delete(key);
			if (!joinedAt) return;

			const minutes = (Date.now() - joinedAt) / 60_000;
			const result = await addVoiceXp(guildId, userId, minutes, settings);
			if (result?.leveledUp) {
				await this.onLevelUp(member, result.newLevel, settings);
			}
			return;
		}

		// ── Switched to a different eligible channel ──────────────────────────────
		if (wasEligible && nowEligible && oldState.channelId !== newState.channelId) {
			// Award XP for time in old channel
			const joinedAt = voiceJoinTimestamps.get(key);
			if (joinedAt) {
				const minutes = (Date.now() - joinedAt) / 60_000;
				const result = await addVoiceXp(guildId, userId, minutes, settings);
				if (result?.leveledUp) {
					await this.onLevelUp(member, result.newLevel, settings);
				}
			}

			// Start fresh timer in new channel (check min members)
			const newChannel = newState.channel;
			if (newChannel) {
				const humans = newChannel.members.filter((m) => !m.user.bot).size;
				if (humans >= settings.voiceMinMembers) {
					voiceJoinTimestamps.set(key, Date.now());
				} else {
					voiceJoinTimestamps.delete(key);
				}
			}
		}
	}

	// ─── Level-up handler ─────────────────────────────────────────────────────────

	private async onLevelUp(member: GuildMember, newLevel: number, settings: LevelSettingsRow) {
		// Assign role rewards
		const rewards = await getLevelRoles(member.guild.id, newLevel);
		for (const { roleId } of rewards) {
			await member.roles.add(roleId).catch(() => null);
		}

		// Send level-up message to the configured channel (if set)
		if (!settings.levelUpChannelId) return;
		const channel = member.guild.channels.cache.get(settings.levelUpChannelId);
		if (!channel?.isTextBased() || !('send' in channel)) return;

		const text = settings.levelUpMessage
			.replace('{mention}', `<@${member.id}>`)
			.replace('{user}', member.user.username)
			.replace('{level}', String(newLevel));

		// biome-ignore lint/suspicious/noExplicitAny: TextBasedChannel send type gap
		await (channel as any).send({ content: text }).catch(() => null);
	}
}
