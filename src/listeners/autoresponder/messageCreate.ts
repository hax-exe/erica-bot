import { Listener } from '@sapphire/framework';
import type { Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { formatAutoresponderResponse, messageMatchesTrigger, parseChannelIds } from '../../lib/AutoresponderUtil.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { db, schema } from '../../lib/database.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

/** key: `${guildId}:${ruleId}:${userId}` → last fire ms */
const cooldowns = new Map<string, number>();

export class AutoresponderMessageListener extends Listener {
	public constructor(context: Listener.LoaderContext) {
		super(context, { event: 'messageCreate' });
	}

	public async run(message: Message) {
		if (!message.inGuild() || message.author.bot || !message.content) return;
		if (!(await isModuleEnabled(message.guildId, 'autoresponder'))) return;
		if (await isBotBlacklisted(message.author.id)) return;

		const rules = await db
			.select()
			.from(schema.autoresponders)
			.where(eq(schema.autoresponders.guildId, message.guildId));

		if (!rules.length) return;

		const now = Date.now();
		for (const rule of rules) {
			if (!rule.enabled) continue;

			const channels = parseChannelIds(rule.channelIds);
			if (channels.length && !channels.includes(message.channelId)) continue;

			if (!messageMatchesTrigger(message.content, rule.trigger, rule.matchMode)) continue;

			const cdKey = `${message.guildId}:${rule.id}:${message.author.id}`;
			const last = cooldowns.get(cdKey) ?? 0;
			if (now - last < rule.cooldownSeconds * 1000) continue;

			cooldowns.set(cdKey, now);

			const content = formatAutoresponderResponse(rule.response, message);
			if (!content) continue;

			if (rule.replyToMessage) {
				await message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => null);
			} else if (message.channel.isSendable()) {
				await message.channel.send({ content }).catch(() => null);
			}

			// One reply per message — first matching rule wins
			return;
		}
	}
}
