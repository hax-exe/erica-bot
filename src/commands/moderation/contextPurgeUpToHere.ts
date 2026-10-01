import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, MessageFlags, PermissionFlagsBits, userMention } from 'discord.js';
import { Colors, errorReply, logContainer, meta, successReply, warningReply } from '../../lib/components.js';
import { sendModLog } from '../../lib/LoggingUtil.js';

/** Messages fetched after the target; with the target itself that fills one 100-message bulk delete. */
const FETCH_LIMIT = 99;

@ApplyOptions<Command.Options>({
	name: 'Purge Up to Here',
	preconditions: ['Moderation'],
})
export class PurgeUpToHereContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('Purge Up to Here')
				.setType(ApplicationCommandType.Message)
				.setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isMessageContextMenuCommand()) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild() || !interaction.channel?.isTextBased()) {
			return interaction.editReply(errorReply('This command can only be used in a server text channel.'));
		}

		const targetMessage = interaction.targetMessage;
		const channel = interaction.channel;

		try {
			// Fetch messages sent after the target message (up to 99 messages, plus the target = one bulk delete)
			const fetched = await channel.messages.fetch({ after: targetMessage.id, limit: FETCH_LIMIT }).catch(() => null);
			if (!fetched) {
				return interaction.editReply(errorReply('Failed to fetch messages.'));
			}
			// A full page means there may be more messages after the target than this run could reach.
			const limitHit = fetched.size >= FETCH_LIMIT;

			const eligible = Array.from(fetched.values());
			eligible.push(targetMessage); // Include the target message itself

			const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
			const toDelete = eligible.filter((m) => m.createdTimestamp > twoWeeksAgo && !m.pinned);

			if (toDelete.length === 0) {
				return interaction.editReply(errorReply('No eligible messages to purge (older than 14 days or pinned).'));
			}

			const deleted = await channel.bulkDelete(toDelete, true);
			const skipped = eligible.length - deleted.size;

			await sendModLog(
				interaction.guild,
				logContainer({
					title: 'Messages Purged',
					color: Colors.Neutral,
					fields: [
						{ name: 'Channel', value: `<#${channel.id}>` },
						{ name: 'Deleted', value: `${deleted.size} message(s)` },
						{ name: 'Moderator', value: `${userMention(interaction.user.id)} (${interaction.user.username})` },
					],
					timestamp: true,
				}),
			).catch(() => null);

			const lines = [`Purged **${deleted.size}** message(s) starting from the target message.`];
			if (skipped > 0) lines.push(meta(`${skipped} message(s) skipped (pinned, older than 14 days, or already gone).`));
			if (limitHit) {
				lines.push(
					meta(
						`Limit reached: one use checks at most ${FETCH_LIMIT + 1} messages, so some messages after the target may remain.`,
					),
				);
			}
			const reply = limitHit || deleted.size === 0 ? warningReply : successReply;
			return interaction.editReply(reply(lines.join('\n')));
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to purge messages.'));
		}
	}
}
