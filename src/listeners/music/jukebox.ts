import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type GuildMember, type Message } from 'discord.js';
import { eq } from 'drizzle-orm';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { db, schema } from '../../lib/database.js';

@ApplyOptions<Listener.Options>({
	name: 'jukeboxMessageCreate',
	event: Events.MessageCreate,
})
export class JukeboxMessageListener extends Listener<typeof Events.MessageCreate> {
	public override async run(message: Message) {
		if (message.author.bot || !message.inGuild()) return;
		if (await isBotBlacklisted(message.author.id)) return;

		try {
			// Check if this channel is the dedicated music channel
			const guildRow = await db.query.guilds.findFirst({
				where: eq(schema.guilds.id, message.guild.id),
			});

			if (guildRow?.musicChannelId !== message.channel.id) return;

			// Immediately delete the user's message to keep the channel clean
			await message.delete().catch(() => null);

			// Use the message content as the query
			const query = message.content.trim();
			if (!query) return;

			// We need to trigger the play logic
			const member = message.member as GuildMember;
			if (!member.voice.channelId) {
				// We can't reply directly to the deleted message, so we send a temporary warning
				const warning = await message.channel.send(
					`⚠️ <@${message.author.id}>, you must be in a voice channel to use the Jukebox.`,
				);
				setTimeout(() => warning.delete().catch(() => null), 5000);
				return;
			}

			// Find the play command and execute it programmatically
			const command = this.container.stores.get('commands').get('play') as any;
			if (!command) return;

			// Spoof the interaction so the play command works
			// Note: The play command heavily relies on interaction.deferReply, editReply, and options.getString
			// We can create a synthetic object that mimics a ChatInputCommandInteraction for the purpose of the play command.

			let replyMessage: Message | null = null;

			const spoofedInteraction = {
				id: message.id,
				user: message.author,
				member: message.member,
				guild: message.guild,
				guildId: message.guild.id,
				channel: message.channel,
				channelId: message.channel.id,
				commandName: 'play',
				options: {
					getString: (name: string) => (name === 'query' ? query : null),
				},
				deferReply: async () => {
					/* No-op for jukebox */
				},
				editReply: async (opts: any) => {
					// Send a temporary status message, then delete it after 5 seconds
					if (!replyMessage) {
						replyMessage = await message.channel.send(opts);
					} else {
						await replyMessage.edit(opts).catch(() => null);
					}
					setTimeout(() => replyMessage?.delete().catch(() => null), 7000);
					return replyMessage;
				},
				followUp: async (opts: any) => {
					const msg = await message.channel.send(opts);
					setTimeout(() => msg.delete().catch(() => null), 7000);
					return msg;
				},
				inCachedGuild: () => true,
			};

			await command.chatInputRun(spoofedInteraction as any);
		} catch (err) {
			this.container.logger.error('[Jukebox]', err);
		}
	}
}
