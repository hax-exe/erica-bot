import { Listener } from '@sapphire/framework';
import { type Message, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, makeContainer, separator } from '../../lib/components.js';
import { getLevelRoles, getOrCreateLevelSettings, getXpMultiplier, tryAddXp } from '../../lib/LevelingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import { safeJsonParse } from '../../lib/safe.js';

export class LevelingMessageCreateListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { name: 'levelingMessageCreate', event: 'messageCreate' });
	}

	public async run(message: Message) {
		if (message.author.bot || !message.inGuild()) return;
		if (!(await isModuleEnabled(message.guildId, 'leveling'))) return;
		if (await isBotBlacklisted(message.author.id)) return;

		const settings = await getOrCreateLevelSettings(message.guildId);
		if (!settings.enabled) return;

		// No-XP channel check
		const noXpChannels = safeJsonParse<string[]>(settings.noXpChannelIds, []);
		if (noXpChannels.includes(message.channelId)) return;

		// No-XP role check — fetch member if not in cache so role checks and rewards work
		const noXpRoles = safeJsonParse<string[]>(settings.noXpRoleIds, []);
		const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
		if (member && noXpRoles.some((r) => member.roles.cache.has(r))) return;

		// In a thread, the parent channel's multiplier applies when the thread has none of its own.
		const parentChannelId = message.channel.isThread() ? message.channel.parentId : null;
		const multiplier = await getXpMultiplier(message.guildId, member, message.channelId, settings, parentChannelId);
		const result = await tryAddXp(message.guildId, message.author.id, settings, multiplier);
		if (!result?.leveledUp) return;

		const { newLevel } = result;

		// Assign any role rewards for this level
		const rewards = await getLevelRoles(message.guildId, newLevel);
		if (member) {
			for (const { roleId } of rewards) {
				await member.roles.add(roleId).catch(() => null);
			}
		}

		// Build level-up announcement
		const mention = `<@${message.author.id}>`;
		const text = settings.levelUpMessage
			.replace('{mention}', mention)
			.replace('{user}', message.author.username)
			.replace('{level}', String(newLevel));

		const avatarUrl = member?.displayAvatarURL({ size: 64, extension: 'png' }) ?? null;
		const container = makeContainer({ color: Colors.Success });

		const section = new SectionBuilder().addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### Level Up\n${text}`),
		);
		if (avatarUrl) section.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
		container.addSectionComponents(section);

		if (rewards.length > 0) {
			const roleList = rewards.map((r) => `<@&${r.roleId}>`).join(', ');
			container.addSeparatorComponents(separator());
			container.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`-# 🎁 Role${rewards.length > 1 ? 's' : ''} unlocked: ${roleList}`),
			);
		}

		const targetChannel =
			settings.levelUpChannelId && message.guild
				? (message.guild.channels.cache.get(settings.levelUpChannelId) ?? message.channel)
				: message.channel;

		if (targetChannel.isTextBased() && 'send' in targetChannel) {
			await (targetChannel.send as (opts: unknown) => Promise<unknown>)({
				components: [container],
				flags: CV2_FLAG,
				allowedMentions: { users: [message.author.id] },
			}).catch(() => null);
		}
	}
}
