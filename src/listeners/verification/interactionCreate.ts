import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	type ButtonInteraction,
	ButtonStyle,
	Events,
	type Interaction,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	ModalBuilder,
	type ModalSubmitInteraction,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { rejectBlacklistedInteraction } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, errorReply, hint, makeContainer, successReply, warningReply } from '../../lib/components.js';
import { logFields } from '../../lib/LoggingUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';
import {
	CAPTCHA_LENGTH,
	CAPTCHA_TTL_MS,
	CODE_BUTTON_ID,
	CODE_MODAL_ID,
	checkPendingCaptcha,
	createPendingCaptcha,
	getVerificationSettings,
	grantVerification,
	hasPendingCaptcha,
	isAccountOldEnough,
	logVerification,
	removeUnverifiedRole,
	renderCaptcha,
	VERIFY_BUTTON_ID,
	type VerificationSettings,
} from '../../lib/VerificationUtil.js';

const DAY_MS = 86_400_000;
const STAFF_HINT =
	'Please ask a staff member to check the role hierarchy (my role must sit above the verification roles).';

function isStaleInteractionError(err: unknown): boolean {
	const code = (err as { code?: unknown } | null)?.code;
	return code === 10062 || code === 40060;
}

/**
 * Handles the three verification interactions. Each branch matches its custom ID exactly so it never
 * claims another feature's components.
 */
@ApplyOptions<Listener.Options>({
	name: 'verificationInteractions',
	event: Events.InteractionCreate,
})
export class VerificationInteractionListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (interaction.isButton()) {
			if (interaction.customId === VERIFY_BUTTON_ID)
				return this.guard(interaction, () => this.handleStart(interaction));
			if (interaction.customId === CODE_BUTTON_ID)
				return this.guard(interaction, () => this.handleCodeButton(interaction));
			return;
		}
		if (interaction.isModalSubmit() && interaction.customId === CODE_MODAL_ID) {
			return this.guard(interaction, () => this.handleModal(interaction));
		}
	}

	/** Blacklist check plus error containment: stale interactions are dropped, anything else is logged and reported. */
	private async guard(interaction: ButtonInteraction | ModalSubmitInteraction, handler: () => Promise<unknown>) {
		try {
			if (await rejectBlacklistedInteraction(interaction)) return;
			await handler();
		} catch (err) {
			if (isStaleInteractionError(err)) return;
			this.container.logger.error('[verification] Interaction failed:', err);
			try {
				const reply = errorReply('Something went wrong while verifying you. Please try again in a moment.');
				if (interaction.deferred || interaction.replied) await interaction.editReply(reply);
				else await interaction.reply(reply as any);
			} catch (replyErr) {
				if (!isStaleInteractionError(replyErr))
					this.container.logger.error('[verification] Could not send error reply:', replyErr);
			}
		}
	}

	// ─── Verify button ───────────────────────────────────────────────────────────

	private async handleStart(interaction: ButtonInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply(errorReply('Server only.') as any);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const settings = await this.loadActiveSettings(interaction.guildId);
		if (!settings) {
			return interaction.editReply(
				errorReply('Verification is not available right now. Please ask a staff member for help.'),
			);
		}
		const roleId = settings.roleId!;

		const member = interaction.member;
		if (member.roles.cache.has(roleId)) return this.replyAlreadyVerified(interaction, settings);

		const minAge = settings.minAccountAgeDays;
		if (!isAccountOldEnough(member.user.createdTimestamp, minAge)) {
			const eligibleAt = Math.ceil((member.user.createdTimestamp + minAge * DAY_MS) / 1000);
			await logVerification(
				interaction.guild,
				'Verification Blocked',
				Colors.Warning,
				[
					logFields.user(member.id),
					logFields.accountCreated(Math.floor(member.user.createdTimestamp / 1000)),
					logFields.reason(`Account is younger than the required ${minAge} day${minAge === 1 ? '' : 's'}.`),
				],
				member.user,
			);
			return interaction.editReply(
				errorReply(
					`Your account is too new to verify here\nDiscord accounts must be at least **${minAge} day${minAge === 1 ? '' : 's'}** old. You can try again <t:${eligibleAt}:R>.`,
				),
			);
		}

		if (!settings.captchaEnabled) return this.grantAndReply(interaction, settings);

		const code = createPendingCaptcha(interaction.guildId, interaction.user.id);
		const image = new AttachmentBuilder(renderCaptcha(code), { name: 'captcha.png' });

		const captchaCard = makeContainer({ color: Colors.Info, header: 'Enter the code' });
		captchaCard.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`Type the ${CAPTCHA_LENGTH} characters from the image below.`),
		);
		captchaCard.addMediaGalleryComponents(
			new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://captcha.png')),
		);
		captchaCard.addTextDisplayComponents(hint(`Not case-sensitive · expires in ${CAPTCHA_TTL_MS / 60_000} minutes`));
		captchaCard.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(CODE_BUTTON_ID).setLabel('Enter code').setStyle(ButtonStyle.Primary),
			),
		);

		return interaction.editReply({ components: [captchaCard], files: [image], flags: CV2_FLAG });
	}

	// ─── Enter code button ───────────────────────────────────────────────────────

	private async handleCodeButton(interaction: ButtonInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply(errorReply('Server only.') as any);

		// A modal must be the only response, so the reply below is the alternative to it, never an addition.
		if (!hasPendingCaptcha(interaction.guildId, interaction.user.id)) {
			return interaction.reply(errorReply('Your code expired. Press **Verify** again to get a new one.') as any);
		}

		const modal = new ModalBuilder()
			.setCustomId(CODE_MODAL_ID)
			.setTitle('Enter the code')
			.addComponents(
				new ActionRowBuilder<TextInputBuilder>().addComponents(
					new TextInputBuilder()
						.setCustomId('code')
						.setLabel('Characters from the image')
						.setStyle(TextInputStyle.Short)
						.setMinLength(CAPTCHA_LENGTH)
						.setMaxLength(CAPTCHA_LENGTH)
						.setRequired(true),
				),
			);
		return interaction.showModal(modal);
	}

	// ─── Code modal ──────────────────────────────────────────────────────────────

	private async handleModal(interaction: ModalSubmitInteraction) {
		if (!interaction.inCachedGuild()) return interaction.reply(errorReply('Server only.') as any);
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const settings = await this.loadActiveSettings(interaction.guildId);
		if (!settings) {
			return interaction.editReply(
				errorReply('Verification is not available right now. Please ask a staff member for help.'),
			);
		}
		if (interaction.member.roles.cache.has(settings.roleId!)) return this.replyAlreadyVerified(interaction, settings);

		const result = checkPendingCaptcha(
			interaction.guildId,
			interaction.user.id,
			interaction.fields.getTextInputValue('code'),
		);
		switch (result.status) {
			case 'expired':
				return interaction.editReply(
					errorReply('Your code expired or was already used. Press **Verify** again to get a new one.'),
				);
			case 'exhausted':
				return interaction.editReply(errorReply('Too many wrong attempts. Press **Verify** again to get a new code.'));
			case 'wrong':
				return interaction.editReply(
					errorReply(
						`That code is not correct. You have ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left; press **Enter code** to try again.`,
					),
				);
			case 'ok':
				return this.grantAndReply(interaction, settings);
		}
	}

	// ─── Shared ──────────────────────────────────────────────────────────────────

	/** The guild's settings when the module is on and a verified role is configured, otherwise null. */
	private async loadActiveSettings(guildId: string): Promise<VerificationSettings | null> {
		if (!(await isModuleEnabled(guildId, 'verification'))) return null;
		const settings = await getVerificationSettings(guildId);
		return settings?.roleId ? settings : null;
	}

	/**
	 * A member can hold both roles, e.g. a returning member whose verified role was restored by role
	 * persistence while the join listener added the unverified role. Clean that up here.
	 */
	private async replyAlreadyVerified(
		interaction: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
		settings: VerificationSettings,
	) {
		switch (await removeUnverifiedRole(interaction.member, settings)) {
			case 'removed':
				return interaction.editReply(
					successReply(`You are already verified. I removed the <@&${settings.unverifiedRoleId}> role you still had.`),
				);
			case 'failed':
				return interaction.editReply(
					errorReply(
						`You are already verified, but I couldn't remove the <@&${settings.unverifiedRoleId}> role. ${STAFF_HINT}`,
					),
				);
			case 'not-held':
				return interaction.editReply(warningReply('You are already verified.'));
		}
	}

	private async grantAndReply(
		interaction: ButtonInteraction<'cached'> | ModalSubmitInteraction<'cached'>,
		settings: VerificationSettings,
	) {
		const result = await grantVerification(interaction.member, settings);
		if (result.ok) {
			return interaction.editReply(successReply(`You are verified and now have <@&${settings.roleId}>. Welcome!`));
		}
		const messages: Record<typeof result.reason, string> = {
			'role-missing': `The verified role no longer exists. ${STAFF_HINT}`,
			'role-unsafe': `The verified role is no longer safe for me to hand out (it has staff permissions or sits above my role). Please ask a staff member to fix it with \`/verification setup\`.`,
			'role-error': `I couldn't give you the verified role. ${STAFF_HINT}`,
			'unverified-role-error': `You are verified and now have <@&${settings.roleId}>, but I couldn't remove the <@&${settings.unverifiedRoleId}> role. ${STAFF_HINT}`,
		};
		// They are verified in that case; only the leftover unverified role needs staff attention.
		const reply = result.reason === 'unverified-role-error' ? warningReply : errorReply;
		return interaction.editReply(reply(messages[result.reason]));
	}
}
