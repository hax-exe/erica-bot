import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator } from '../../lib/components.js';
import { getNotes } from '../../lib/ModerationUtil.js';

@ApplyOptions<Command.Options>({
	name: 'View Mod Notes',
	preconditions: ['Moderation'],
})
export class ViewModNotesContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('View Mod Notes')
				.setType(ApplicationCommandType.User)
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isUserContextMenuCommand()) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));

		const target = interaction.targetUser;
		const notes = await getNotes(interaction.guildId, target.id);

		const c = makeContainer({
			color: notes.length === 0 ? Colors.Neutral : Colors.Info,
			header: `Notes — ${target.username}`,
		});

		if (notes.length === 0) {
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('No notes found for this user.'));
		} else {
			c.addSeparatorComponents(separator());
			// Show up to 10 latest notes for preview in the context menu
			const notesToShow = notes.slice(0, 10);
			for (const note of notesToShow) {
				const ts = Math.floor(new Date(note.createdAt).getTime() / 1000);
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`**#${note.id}** — <@${note.moderatorId}> • <t:${ts}:R>\n${note.content}`,
					),
				);
				c.addSeparatorComponents(separator());
			}
			if (notes.length > 10) {
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`-# Showing 10 of ${notes.length} notes. Use \`/note list\` to view all.`,
					),
				);
			}
		}

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
