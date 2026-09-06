import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { MessageFlags, PermissionFlagsBits, userMention } from 'discord.js';
import { Colors, errorReply, logContainer, successReply } from '../../lib/components.js';
import { sendModLog } from '../../lib/LoggingUtil.js';

@ApplyOptions<Command.Options>({
	name: 'purge',
	description: 'Bulk-delete messages from the current channel.',
	preconditions: ['Moderation'],
})
export class PurgeCommand extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('purge')
				.setDescription('Bulk-delete messages from the current channel.')
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
				.addIntegerOption((o) =>
					o
						.setName('amount')
						.setDescription('Number of messages to delete (1–100).')
						.setMinValue(1)
						.setMaxValue(100)
						.setRequired(true),
				)
				.addUserOption((o) =>
					o.setName('user').setDescription('Only delete messages from this user.').setRequired(false),
				)
				.addStringOption((o) =>
					o
						.setName('filter')
						.setDescription('Additional content filter.')
						.setRequired(false)
						.addChoices(
							{ name: 'Bots Only', value: 'bots' },
							{ name: 'Images/Attachments', value: 'images' },
							{ name: 'Links', value: 'links' },
							{ name: 'Discord Invites', value: 'invites' },
						),
				),
		);
	}

	public override async chatInputRun(interaction: Command.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild() || !interaction.channel?.isTextBased()) {
			return interaction.editReply(errorReply('This command can only be used in a server text channel.'));
		}

		if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
			return interaction.editReply(errorReply('You do not have permission to manage messages.'));
		}

		const amount = interaction.options.getInteger('amount', true);
		const filterUser = interaction.options.getUser('user');
		const filterType = interaction.options.getString('filter');
		const channel = interaction.channel;

		const eligible: import('discord.js').Message[] = [];
		const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
		let lastMessageId: string | undefined;
		let totalFetched = 0;
		const MAX_FETCH = 1000;

		while (eligible.length < amount && totalFetched < MAX_FETCH) {
			const fetchOptions: { limit: number; before?: string } = { limit: 100 };
			if (lastMessageId) fetchOptions.before = lastMessageId;

			const fetchedRaw = await channel.messages.fetch(fetchOptions).catch(() => null);
			if (!fetchedRaw || fetchedRaw.size === 0) break;

			totalFetched += fetchedRaw.size;
			lastMessageId = fetchedRaw.last()?.id;

			let fetched = fetchedRaw.filter((m: any) => m.createdTimestamp > twoWeeksAgo && !m.pinned);
			if (fetched.size === 0) break;

			if (filterUser) {
				fetched = fetched.filter((m: any) => m.author.id === filterUser.id);
			}

			if (filterType) {
				fetched = fetched.filter((m: any) => {
					if (filterType === 'bots') return m.author.bot;
					if (filterType === 'images')
						return m.attachments.size > 0 || m.embeds.some((e: any) => e.image || e.video || e.thumbnail);
					if (filterType === 'links') return /(https?:\/\/[^\s]+)/gi.test(m.content);
					if (filterType === 'invites')
						return /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/gi.test(m.content);
					return true;
				});
			}

			for (const msg of fetched.values()) {
				if (eligible.length < amount) {
					eligible.push(msg);
				} else {
					break;
				}
			}
		}

		if (eligible.length === 0) {
			return interaction.editReply(
				errorReply('No eligible messages found (messages older than 14 days or all messages are pinned).'),
			);
		}

		try {
			const deleted = await channel.bulkDelete(eligible, true);

			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Messages Purged',
					color: Colors.Neutral,
					fields: [
						{ name: 'Channel', value: `<#${channel.id}>` },
						{ name: 'Deleted', value: `${deleted.size} message(s)` },
						...(filterUser
							? [{ name: 'Filter', value: `${userMention(filterUser.id)} (${filterUser.username})` }]
							: []),
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			return interaction.editReply(
				successReply(`Deleted **${deleted.size}** message(s)${filterUser ? ` from **${filterUser.username}**` : ''}.`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to delete messages.'));
		}
	}
}
