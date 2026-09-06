import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { ChannelType, Events, type Interaction, MessageFlags, userMention } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, errorReply, logContainer, successReply } from '../../lib/components.js';
import { getGuildSettings, sendReportLog } from '../../lib/LoggingUtil.js';
import { getModActionRow } from '../../lib/ModerationUtil.js';

const REPORT_USER_PREFIX = 'report:user:';
const REPORT_MSG_PREFIX = 'report:msg:';

@ApplyOptions<Listener.Options>({
	event: Events.InteractionCreate,
	name: 'reportInteractionCreate',
})
export class ReportInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isModalSubmit()) return;
		if (!interaction.customId.startsWith('report:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// ── User report ────────────────────────────────────────────────────────────

		if (interaction.customId.startsWith(REPORT_USER_PREFIX)) {
			const userId = interaction.customId.slice(REPORT_USER_PREFIX.length);
			const reason = interaction.fields.getTextInputValue('reason');

			const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
			if (!targetUser) {
				return interaction.editReply(errorReply('Could not find that user.'));
			}

			const container = logContainer({
				title: 'User Report',
				color: Colors.Warning,
				fields: [
					{
						name: 'Reported User',
						value: `${userMention(targetUser.id)} (${targetUser.tag} · \`${targetUser.id}\`)`,
					},
					{
						name: 'Reported By',
						value: `${userMention(interaction.user.id)} (${interaction.user.tag})`,
					},
					{ name: 'Reason', value: reason },
				],
				timestamp: true,
			});

			const actionRows = getModActionRow(targetUser.id);
			container.addActionRowComponents(...actionRows);

			const sent = await sendReportLog(interaction.guild, container);

			if (!sent) {
				return interaction.editReply(
					errorReply('Reports are not configured on this server. Please contact a staff member directly.'),
				);
			}

			// Spawn private discussion thread
			await this.spawnDiscussionThread(interaction, targetUser.username);

			return interaction.editReply(successReply('Your report has been submitted to the staff team. Thank you.'));
		}

		// ── Message report ─────────────────────────────────────────────────────────

		if (interaction.customId.startsWith(REPORT_MSG_PREFIX)) {
			const rest = interaction.customId.slice(REPORT_MSG_PREFIX.length);
			const colonIdx = rest.indexOf(':');
			const channelId = rest.slice(0, colonIdx);
			const messageId = rest.slice(colonIdx + 1);
			const reason = interaction.fields.getTextInputValue('reason');

			const channel = interaction.guild.channels.cache.get(channelId);
			const message = channel?.isTextBased() ? await channel.messages.fetch(messageId).catch(() => null) : null;

			const fields: Array<{ name: string; value: string }> = [];
			if (message) {
				fields.push({
					name: 'Reported User',
					value: `${userMention(message.author.id)} (${message.author.tag} · \`${message.author.id}\`)`,
				});
				const preview = message.content
					? message.content.length > 300
						? `${message.content.slice(0, 300)}…`
						: message.content
					: '*(no text content)*';
				fields.push({
					name: 'Message',
					value: `[Jump to message](${message.url})\n> ${preview}`,
				});
			} else {
				fields.push({ name: 'Channel', value: `<#${channelId}>` });
				fields.push({ name: 'Message ID', value: `\`${messageId}\`` });
			}
			fields.push({
				name: 'Reported By',
				value: `${userMention(interaction.user.id)} (${interaction.user.tag})`,
			});
			fields.push({ name: 'Reason', value: reason });

			const container = logContainer({
				title: 'Message Report',
				color: Colors.Warning,
				fields,
				timestamp: true,
			});

			if (message) {
				const actionRows = getModActionRow(message.author.id);
				container.addActionRowComponents(...actionRows);
			}

			const sent = await sendReportLog(interaction.guild, container);

			if (!sent) {
				return interaction.editReply(
					errorReply('Reports are not configured on this server. Please contact a staff member directly.'),
				);
			}

			const username = message ? message.author.username : 'user';
			await this.spawnDiscussionThread(interaction, username);

			return interaction.editReply(successReply('Your report has been submitted to the staff team. Thank you.'));
		}
	}

	private async spawnDiscussionThread(interaction: Interaction, reportedUsername: string) {
		if (!interaction.guild) return;

		const settings = await getGuildSettings(interaction.guild.id);
		const webhookUrl = settings?.reportWebhookUrl;
		if (!webhookUrl) return;

		const match = webhookUrl.match(/\/webhooks\/(\d+)\//);
		if (!match) return;

		const webhookId = match[1];
		const webhook = await interaction.client.fetchWebhook(webhookId).catch(() => null);
		if (!webhook || !webhook.channelId) return;

		const reportChannel =
			interaction.guild.channels.cache.get(webhook.channelId) ||
			(await interaction.guild.channels.fetch(webhook.channelId).catch(() => null));

		if (reportChannel && 'threads' in reportChannel) {
			try {
				await (reportChannel as any).threads.create({
					name: `🚩-report-${reportedUsername}`,
					autoArchiveDuration: 1440,
					type: ChannelType.GuildPrivateThread,
					reason: `Private discussion for report of ${reportedUsername}`,
				});
			} catch (err) {
				this.container.logger.error('[Reports] Failed to spawn private discussion thread:', err);
			}
		}
	}
}
