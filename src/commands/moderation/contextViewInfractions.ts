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
import { getInfractions } from '../../lib/ModerationUtil.js';

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

		const container = makeContainer({
			color: infractions.length === 0 ? Colors.Success : Colors.Warning,
			header: `Moderation History — ${target.tag}`,
		});

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`${userMention(target.id)} \`${target.id}\` — **${infractions.length}** infraction(s) total`,
			),
		);

		if (infractions.length === 0) {
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent('✅ No infractions found.'));
		} else {
			container.addSeparatorComponents(separator());
			for (const inf of infractions.slice(0, 10)) {
				const emoji = INFRACTION_EMOJI[inf.type] ?? '📌';
				const ts = Math.floor(new Date(inf.createdAt).getTime() / 1000);
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`${emoji} **Case \`${inf.caseId}\`** — ${inf.type.toUpperCase()}\n` +
							`${field('Moderator', `<@${inf.moderatorId}>`)}\n` +
							`${field('Reason', inf.reason)}\n` +
							`-# <t:${ts}:F>`,
					),
				);
				container.addSeparatorComponents(
					new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
				);
			}
			if (infractions.length > 10) {
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`-# … and ${infractions.length - 10} more (showing 10 most recent)`),
				);
			}
		}

		return interaction.editReply(cv2Reply(container, true));
	}
}
