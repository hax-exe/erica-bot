import { ApplyOptions } from '@sapphire/decorators';
import { Command } from '@sapphire/framework';
import {
	ApplicationCommandType,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	TextDisplayBuilder,
	userMention,
} from 'discord.js';
import { Colors, cv2Reply, errorReply, field, makeContainer, separator } from '../../lib/components.js';
import { getInfractions, truncateText } from '../../lib/ModerationUtil.js';

/** Discord caps the text of one CV2 message at 4000 characters; keep headroom for headers and the footer line. */
const TEXT_BUDGET = 3800;
const MAX_REASON_LENGTH = 200;

const INFRACTION_EMOJI: Record<string, string> = {
	ban: '🔨',
	unban: '🔓',
	kick: '👢',
	timeout: '⏱️',
	softban: '💥',
	warn: '⚠️',
};

@ApplyOptions<Command.Options>({
	name: 'View Infractions',
	preconditions: ['Moderation'],
})
export class ViewInfractionsContextMenu extends Command {
	public override registerApplicationCommands(registry: Command.Registry) {
		registry.registerContextMenuCommand((builder) =>
			builder
				.setName('View Infractions')
				.setType(ApplicationCommandType.User)
				.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
		);
	}

	public override async contextMenuRun(interaction: Command.ContextMenuCommandInteraction) {
		if (!interaction.isUserContextMenuCommand()) return;
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (!interaction.inCachedGuild()) {
			return interaction.editReply(errorReply('This command can only be used in a server.'));
		}

		const target = interaction.targetUser;
		const infractions = await getInfractions(interaction.guild.id, target.id);

		const header = `Moderation History — ${target.tag}`;
		const summary = `${userMention(target.id)} \`${target.id}\` — **${infractions.length}** infraction(s) total`;
		const container = makeContainer({
			color: infractions.length === 0 ? Colors.Success : Colors.Warning,
			header,
		});

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(summary));

		if (infractions.length === 0) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ No infractions found.'));
		} else {
			container.addSeparatorComponents(separator());
			// Clip each reason and stop before the message's total text would pass Discord's CV2 cap.
			let budget = TEXT_BUDGET - header.length - summary.length;
			let shown = 0;
			for (const inf of infractions.slice(0, 10)) {
				const emoji = INFRACTION_EMOJI[inf.type] ?? '📌';
				const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
				const block =
					`${emoji} **Case \`${inf.caseId}\`** — ${inf.type.toUpperCase()}\n` +
					`${field('Moderator', `<@${inf.moderatorId}>`)}\n` +
					`${field('Reason', truncateText(inf.reason, MAX_REASON_LENGTH))}\n` +
					`-# <t:${ts}:F>`;
				if (block.length > budget) break;
				budget -= block.length;
				shown++;
				container.addTextDisplayComponents(new TextDisplayBuilder().setContent(block));
				container.addSeparatorComponents(
					new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
				);
			}
			if (infractions.length > shown) {
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`-# … and ${infractions.length - shown} more (showing ${shown} most recent)`,
					),
				);
			}
		}

		return interaction.editReply(cv2Reply(container, true));
	}
}
