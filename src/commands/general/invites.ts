import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { BOT_NAME } from '../../lib/brand.js';
import { Colors, cv2Reply, field, makeContainer, separator } from '../../lib/components.js';
import {
	buildInviteLeaderboardPage,
	getInviterCounts,
	getLatestJoin,
	requireInviteTracking,
} from '../../lib/InviteTrackingUtil.js';

type InviteJoinRow = NonNullable<Awaited<ReturnType<typeof getLatestJoin>>>;

const unixSeconds = (ms: number) => Math.floor(ms / 1000);

/** "<@inviter> · `code`", or why the inviter is unknown. */
function describeInviter(row: InviteJoinRow | null): string {
	if (!row) return 'Unknown — no join was recorded (they may have joined before tracking was on)';
	if (!row.inviterId) return 'Unknown — vanity URL, or the invite could not be determined';
	return row.inviteCode ? `<@${row.inviterId}> · \`${row.inviteCode}\`` : `<@${row.inviterId}>`;
}

@ApplyOptions<Subcommand.Options>({
	name: 'invites',
	description: 'See who invited whom and the invite leaderboard.',
	subcommands: [
		{ name: 'view', chatInputRun: 'chatInputView' },
		{ name: 'leaderboard', chatInputRun: 'chatInputLeaderboard' },
		{ name: 'inviter', chatInputRun: 'chatInputInviter' },
	],
})
export class InvitesCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('invites')
				.setDescription('See who invited whom and the invite leaderboard.')
				.addSubcommand((sub) =>
					sub
						.setName('view')
						.setDescription("View a member's invite stats.")
						.addUserOption((o) =>
							o.setName('user').setDescription('The member to view (default: you).').setRequired(false),
						),
				)
				.addSubcommand((sub) => sub.setName('leaderboard').setDescription('Top inviters in this server.'))
				.addSubcommand((sub) =>
					sub
						.setName('inviter')
						.setDescription('See who invited a member.')
						.addUserOption((o) => o.setName('user').setDescription('The member to look up.').setRequired(true)),
				),
		);
	}

	public async chatInputView(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await requireInviteTracking(interaction);
		if (!guild) return;

		const user = interaction.options.getUser('user') ?? interaction.user;
		const [counts, joinRow] = await Promise.all([
			getInviterCounts(guild.id, user.id),
			getLatestJoin(guild.id, user.id),
		]);

		const card = makeContainer({ color: Colors.Info, header: `Invites — ${user.username}` });
		card.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					field('Invites', counts.effective.toLocaleString()),
					field('Joins', counts.joins.toLocaleString()),
					field('Left', counts.left.toLocaleString()),
					field('Fake', counts.fake.toLocaleString()),
				].join('\n'),
			),
		);
		card.addSeparatorComponents(separator());
		card.addTextDisplayComponents(new TextDisplayBuilder().setContent(field('Invited by', describeInviter(joinRow))));
		card.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'-# Invites = joins who are still here and were not fake (account under 7 days old at join).',
			),
		);
		if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
			card.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`-# ${BOT_NAME} needs the **Manage Server** permission to read invites. Without it, new joins can't be attributed.`,
				),
			);
		}
		return interaction.editReply(cv2Reply(card, true));
	}

	public async chatInputLeaderboard(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await requireInviteTracking(interaction);
		if (!guild) return;

		return interaction.editReply(await buildInviteLeaderboardPage(guild.id, 0));
	}

	public async chatInputInviter(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const guild = await requireInviteTracking(interaction);
		if (!guild) return;

		const user = interaction.options.getUser('user', true);
		const row = await getLatestJoin(guild.id, user.id);

		const card = makeContainer({ color: Colors.Info, header: `Inviter — ${user.username}` });
		const lines = [field('Invited by', describeInviter(row))];
		if (row) lines.push(field('Joined', `<t:${unixSeconds(row.joinedAt)}:R>`));
		card.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		return interaction.editReply(cv2Reply(card, true));
	}
}
