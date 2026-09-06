import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Message, TextDisplayBuilder } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { storySessions } from '../../lib/GameStore.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const VALID_WORD = /^\p{L}[\p{L}'-]*$/u; // letters only (allows apostrophes and hyphens)
const MILESTONE_EVERY = 25; // post the story so far every N words

@ApplyOptions<Listener.Options>({
	name: 'storyMessage',
	event: Events.MessageCreate,
})
export class StoryMessageListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (!message.inGuild() || message.author.bot) return;
		if (!(await isModuleEnabled(message.guildId, 'fun'))) return;
		if (await isBotBlacklisted(message.author.id)) return;

		const session = storySessions.get(message.channelId);
		if (!session) return;

		const word = message.content.trim();

		// Must be a single word
		if (!VALID_WORD.test(word) || word.includes(' ')) {
			await message.react('❌').catch(() => null);
			await message
				.reply(`❌ One word at a time! (letters only, no spaces)`)
				.then((m) => {
					setTimeout(() => m.delete().catch(() => null), 5000);
				})
				.catch(() => null);
			return;
		}

		// Same user can't go twice in a row
		if (session.lastUserId === message.author.id) {
			await message.react('❌').catch(() => null);
			await message
				.reply(`❌ You can't add two words in a row — wait for someone else!`)
				.then((m) => {
					setTimeout(() => m.delete().catch(() => null), 5000);
				})
				.catch(() => null);
			return;
		}

		// Accept the word
		session.words.push(word);
		session.lastUserId = message.author.id;

		await message.react('✅').catch(() => null);

		// Post milestone every MILESTONE_EVERY words
		if (session.words.length % MILESTONE_EVERY === 0) {
			const c = makeContainer({ color: Colors.Info });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### 📖 Story So Far (${session.words.length} words)\n${session.words.join(' ')}`,
				),
			);
			await message.channel.send({ components: [c], flags: CV2_FLAG as any }).catch(() => null);
		}
	}
}
