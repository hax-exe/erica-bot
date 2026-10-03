import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { errorReply } from '../../lib/components.js';
import {
	buildInviteLeaderboardPage,
	INVITE_LEADERBOARD_PREFIX,
	INVITE_TRACKING_OFF_MESSAGE,
} from '../../lib/InviteTrackingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

/** Previous / Next buttons on `/invites leaderboard` (`invites:lb:<page>`). */
@ApplyOptions<Listener.Options>({
	name: 'inviteLeaderboardPagination',
	event: Events.InteractionCreate,
})
export class InviteLeaderboardPaginationListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton() || !interaction.customId.startsWith(INVITE_LEADERBOARD_PREFIX)) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		try {
			await interaction.deferUpdate();

			if (!(await isModuleEnabled(interaction.guildId, 'inviteTracking'))) {
				await interaction.editReply(errorReply(INVITE_TRACKING_OFF_MESSAGE));
				return;
			}

			const page = Number.parseInt(interaction.customId.slice(INVITE_LEADERBOARD_PREFIX.length), 10);
			await interaction.editReply(await buildInviteLeaderboardPage(interaction.guildId, Number.isNaN(page) ? 0 : page));
		} catch (err: any) {
			// 10062 / 40060: stale or already-acknowledged interaction (e.g. after a restart).
			if (err?.code === 10062 || err?.code === 40060) return;
			throw err;
		}
	}
}
