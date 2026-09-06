import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { channelMention, Events, userMention, type VoiceChannelEffect } from 'discord.js';
import { Colors, logContainer } from '../../lib/components.js';
import { formatUser, sendLog } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'voiceChannelEffectSendLogging',
	event: Events.VoiceChannelEffectSend,
})
export class VoiceChannelEffectSendListener extends Listener<typeof Events.VoiceChannelEffectSend> {
	public override async run(effect: VoiceChannelEffect) {
		const guild = effect.guild;
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;

		const emojiRaw = effect.emoji as { id?: string | null; name?: string | null; animated?: boolean } | null;
		const emoji = emojiRaw?.id
			? `<${emojiRaw.animated ? 'a' : ''}:${emojiRaw.name ?? '?'}:${emojiRaw.id}>`
			: (emojiRaw?.name ?? '*(unknown)*');

		await sendLog(
			guild,
			logContainer({
				title: 'Voice Channel Effect Sent',
				color: Colors.Voice,
				fields: [
					{ name: 'User', value: `${formatUser(effect.userId)}` },
					{ name: 'Channel', value: channelMention(effect.channelId) },
					{ name: 'Emoji', value: emoji },
				],
				timestamp: true,
			}),
			effect.channelId,
		).catch(() => null);
	}
}
