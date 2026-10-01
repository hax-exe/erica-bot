import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import { ApplicationCommandType, MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator } from '../../lib/components.js';
import { getNotes, truncateText } from '../../lib/ModerationUtil.js';

/** Discord caps the text of one CV2 message at 4000 characters; keep headroom for the header and footer line. */
const TEXT_BUDGET = 3800;
const MAX_NOTE_LENGTH = 300;

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
			// Show up to 10 latest notes for preview in the context menu. Notes can be 500 characters,
			// so clip them and stop before the message's total text would pass Discord's CV2 cap.
			let budget = TEXT_BUDGET;
			let shown = 0;
			for (const note of notes.slice(0, 10)) {
				const ts = Math.floor(new Date(note.createdAt).getTime() / 1000);
				const block = `**#${note.id}** — <@${note.moderatorId}> • <t:${ts}:R>\n${truncateText(note.content, MAX_NOTE_LENGTH)}`;
				if (block.length > budget) break;
				budget -= block.length;
				shown++;
				c.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
				c.addSeparatorComponents(separator());
			}
			if (notes.length > shown) {
				c.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`-# Showing ${shown} of ${notes.length} notes. Use \`/mod note list\` to view all.`,
					),
				);
			}
		}

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}
}
