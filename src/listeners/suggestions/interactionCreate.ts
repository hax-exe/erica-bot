import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { CV2_FLAG, errorReply } from '../../lib/components.js';
import { buildSuggestionContainer, castVote, getSuggestion } from '../../lib/SuggestionUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'suggestionInteractions',
	event: Events.InteractionCreate,
})
export class SuggestionInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('suggestion:')) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		const [, action, rawId] = interaction.customId.split(':');
		const suggestionId = Number.parseInt(rawId, 10);
		if (Number.isNaN(suggestionId)) return;

		if (action !== 'upvote' && action !== 'downvote') return;

		// Acknowledge silently — we'll edit the message in place
		await interaction.deferUpdate();

		const suggestion = await getSuggestion(suggestionId);
		if (!suggestion) {
			// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
			await interaction.followUp(errorReply('Suggestion not found.') as any);
			return;
		}

		const voteType = action === 'upvote' ? 'up' : 'down';
		const updated = await castVote(suggestionId, interaction.user.id, voteType);

		// Edit the original message with updated vote counts
		await interaction.editReply({
			components: [buildSuggestionContainer(updated)],
			// biome-ignore lint/suspicious/noExplicitAny: CV2 flag type gap
			flags: CV2_FLAG as any,
		});
	}
}
