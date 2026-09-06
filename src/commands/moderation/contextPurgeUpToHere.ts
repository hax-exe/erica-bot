import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, MessageFlags, PermissionFlagsBits, userMention } from 'discord.js';
import { Colors, errorReply, logContainer, successReply } from '../../lib/components.js';
import { sendModLog } from '../../lib/LoggingUtil.js';

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
			// Fetch messages sent after the target message (up to 99 messages)
			const fetched = await channel.messages.fetch({ after: targetMessage.id, limit: 99 }).catch(() => null);
			if (!fetched) {
				return interaction.editReply(errorReply('Failed to fetch messages.'));
			}

			const eligible = Array.from(fetched.values());
			eligible.push(targetMessage); // Include the target message itself

			const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
			const toDelete = eligible.filter((m) => m.createdTimestamp > twoWeeksAgo && !m.pinned);

			if (toDelete.length === 0) {
				return interaction.editReply(errorReply('No eligible messages to purge (older than 14 days or pinned).'));
			}

			const deleted = await channel.bulkDelete(toDelete, true);

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

			return interaction.editReply(
				successReply(`Successfully purged **${deleted.size}** message(s) starting from target message.`),
			);
		} catch (err) {
			this.container.logger.error(err);
			return interaction.editReply(errorReply('Failed to purge messages.'));
		}
	}
}
