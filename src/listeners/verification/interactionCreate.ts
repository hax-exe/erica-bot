import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import { Events, type Interaction, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { minecraftLinks } from '../../db/schema.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, makeContainer, separator } from '../../lib/components.js';
import { db } from '../../lib/database.js';
import { generateVerificationCode, VERIFY_BUTTON_ID } from '../../lib/VerificationUtil.js';

@ApplyOptions<Listener.Options>({
	name: 'verificationButtonHandler',
	event: Events.InteractionCreate,
})
export class VerificationButtonListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (!interaction.isButton()) return;
		if (interaction.customId !== VERIFY_BUTTON_ID) return;
		if (!interaction.inCachedGuild()) return;
		if (await isBotBlacklisted(interaction.user.id)) return;

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		// Check if already verified
		const [existing] = await db.select().from(minecraftLinks).where(eq(minecraftLinks.userId, interaction.user.id));

		const code = await generateVerificationCode(interaction.user.id, interaction.guildId);

		const container = makeContainer({ color: Colors.Info });

		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				'Join **play.aloramc.net** and run `/verify <token>` to verify this is your account.',
			),
		);

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### \`${code}\``));

		container.addSeparatorComponents(separator());

		const footerLines = ['⏱️ This token expires in **15 minutes**.'];
		if (existing) {
			footerLines.push(
				`ℹ️ You are currently linked as **${existing.minecraftName}**. Completing this will update your linked account.`,
			);
		}
		footerLines.push('-# Do not share this token with anyone.');

		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerLines.join('\n')));

		return interaction.editReply({ components: [container], flags: CV2_FLAG });
	}
}
