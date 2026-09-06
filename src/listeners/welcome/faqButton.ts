import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { type ButtonInteraction, Events, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, makeContainer } from '../../lib/components.js';
import { resolveTag } from '../../lib/TagManager.js';

@ApplyOptions<Listener.Options>({
	name: 'welcomeFaqButton',
	event: Events.InteractionCreate,
})
export class WelcomeFaqButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: ButtonInteraction) {
		if (!interaction.isButton()) return;
		if (!interaction.customId.startsWith('welcome_faq:')) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		if (!interaction.inCachedGuild()) {
			return interaction.reply({ content: 'Server only.', flags: MessageFlags.Ephemeral });
		}

		const guildId = interaction.customId.slice('welcome_faq:'.length);
		if (guildId !== interaction.guildId) {
			return interaction.reply({ content: 'Wrong server.', flags: MessageFlags.Ephemeral });
		}

		const tag = await resolveTag(interaction.guildId, 'faq');
		if (!tag) {
			return interaction.reply({
				content: 'No `faq` tag found — create one with `/tag create name:faq`.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const c = makeContainer({ color: Colors.Info, header: tag.embed?.title || 'Server FAQ' });
		const body = tag.embed?.description || tag.content || '*Empty FAQ tag.*';
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(body.slice(0, 3900)));

		return interaction.reply({
			components: [c],
			flags: (CV2_FLAG | MessageFlags.Ephemeral) as any,
		});
	}
}
