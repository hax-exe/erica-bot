import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, type VoiceState } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { logFields, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'voiceStateUpdateLogging',
	event: Events.VoiceStateUpdate,
})
export class VoiceStateUpdateListener extends Listener<typeof Events.VoiceStateUpdate> {
	public override async run(oldState: VoiceState, newState: VoiceState) {
		const guild = newState.guild;
		// Fetch member if not in cache — voice events can arrive before GUILD_MEMBERS is populated
		let member = newState.member ?? oldState.member;
		if (!member) {
			const userId = newState.id ?? oldState.id;
			if (userId) member = await guild.members.fetch(userId).catch(() => null);
		}
		if (!member || member.user.bot) return;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const joined = !oldState.channelId && newState.channelId;
		const left = oldState.channelId && !newState.channelId;
		const moved = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
		const voiceLog = (title: string, color: number, fields: Array<{ name: string; value: string }>) =>
			logContainer({
				title,
				color,
				fields: [logFields.user(member.id), ...fields],
				targetUser: member.user,
			});

		if (joined) {
			await sendLog(
				guild,
				voiceLog('Joined Voice', Colors.Voice, [
					// biome-ignore lint/style/noNonNullAssertion: channelId is guaranteed non-null when joining
					{ name: 'Channel', value: channelMention(newState.channelId!) },
				]),
				newState.channelId ?? undefined,
			).catch(() => null);
		} else if (left) {
			await sendLog(
				guild,
				voiceLog('Left Voice', Colors.Neutral, [
					// biome-ignore lint/style/noNonNullAssertion: channelId is guaranteed non-null when leaving
					{ name: 'Channel', value: channelMention(oldState.channelId!) },
				]),
				oldState.channelId ?? undefined,
			).catch(() => null);
		} else if (moved) {
			// Suppress if either channel is ignored
			const channelIdForCheck = oldState.channelId ?? newState.channelId ?? undefined;
			await sendLog(
				guild,
				voiceLog('Moved Voice Channel', Colors.Voice, [
					// biome-ignore lint/style/noNonNullAssertion: channelIds are guaranteed non-null when moving
					{ name: 'From', value: channelMention(oldState.channelId!) },
					{ name: 'To', value: channelMention(newState.channelId!) },
				]),
				channelIdForCheck,
			).catch(() => null);
		}

		// Self-state changes — only relevant while the member is in a channel
		if (!newState.channelId && !oldState.channelId) return;
		const activeChannelId = newState.channelId ?? oldState.channelId ?? undefined;

		if (!oldState.selfMute && newState.selfMute) {
			await sendLog(
				guild,
				voiceLog('Self Muted', Colors.Neutral, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		} else if (oldState.selfMute && !newState.selfMute) {
			await sendLog(
				guild,
				voiceLog('Self Unmuted', Colors.Neutral, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		}

		if (!oldState.selfDeaf && newState.selfDeaf) {
			await sendLog(
				guild,
				voiceLog('Self Deafened', Colors.Neutral, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		} else if (oldState.selfDeaf && !newState.selfDeaf) {
			await sendLog(
				guild,
				voiceLog('Self Undeafened', Colors.Neutral, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		}

		if (!oldState.streaming && newState.streaming) {
			await sendLog(
				guild,
				voiceLog('Screen Share Started', Colors.Voice, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		} else if (oldState.streaming && !newState.streaming) {
			await sendLog(
				guild,
				voiceLog('Screen Share Stopped', Colors.Neutral, [
					{ name: 'Channel', value: channelMention(activeChannelId!) },
				]),
				activeChannelId,
			).catch(() => null);
		}

		if (!oldState.selfVideo && newState.selfVideo) {
			await sendLog(
				guild,
				voiceLog('Camera Turned On', Colors.Voice, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		} else if (oldState.selfVideo && !newState.selfVideo) {
			await sendLog(
				guild,
				voiceLog('Camera Turned Off', Colors.Neutral, [{ name: 'Channel', value: channelMention(activeChannelId!) }]),
				activeChannelId,
			).catch(() => null);
		}
	}
}
