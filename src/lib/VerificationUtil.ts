import { randomBytes } from 'node:crypto';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	TextDisplayBuilder,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { pendingVerifications } from '../db/schema.js';
import { Colors, makeContainer, separator } from './components.js';
import { db } from './database.js';

export const VERIFY_BUTTON_ID = 'verification:start';

const CODE_TTL_MS = 15 * 60 * 1000;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Generate a token in XXX-XXX format matching the website (e.g. TUX-F3J). */
function generateToken(): string {
	const b = randomBytes(6);
	const prefix = Array.from(b.subarray(0, 3), (n) => LETTERS[n % 26]).join('');
	const suffix = Array.from(b.subarray(3, 6), (n) => ALPHANUM[n % 36]).join('');
	return `${prefix}-${suffix}`;
}

export async function generateVerificationCode(userId: string, guildId: string): Promise<string> {
	const code = generateToken();
	const expiresAt = new Date(Date.now() + CODE_TTL_MS);

	await db.insert(pendingVerifications).values({ userId, guildId, code, expiresAt }).onDuplicateKeyUpdate({
		set: { code, guildId, expiresAt },
	});

	return code;
}

/**
 * Look up a pending verification by code.
 * Returns the row if valid and not expired, otherwise null.
 * Does NOT delete the row — the caller is responsible for cleanup.
 */
export async function lookupVerificationCode(code: string): Promise<typeof pendingVerifications.$inferSelect | null> {
	const rows = await db.select().from(pendingVerifications).where(eq(pendingVerifications.code, code.toUpperCase()));

	const row = rows[0];
	if (!row) return null;
	if (row.expiresAt.getTime() < Date.now()) {
		await db.delete(pendingVerifications).where(eq(pendingVerifications.userId, row.userId));
		return null;
	}

	return row;
}

/** Delete a pending verification after it has been consumed. */
export async function consumeVerification(userId: string): Promise<void> {
	await db.delete(pendingVerifications).where(eq(pendingVerifications.userId, userId));
}

/** Build the CV2 verification panel container for posting in a channel. */
export function buildVerificationPanel() {
	const container = makeContainer({ color: Colors.Info });

	container.addMediaGalleryComponents(
		new MediaGalleryBuilder().addItems(
			new MediaGalleryItemBuilder().setURL(
				'https://media.discordapp.net/attachments/1025459729155244173/1496253058303266937/AMC_verification-banner.png?ex=69efcd40&is=69ee7bc0&hm=9e38c4844fbbb1f34829f117b3351398bd0c9a636a2a13987821eaf964d366b7&=&format=webp&quality=lossless&width=4096&height=442',
			),
		),
	);

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			[
				'### 📖 Verify with AloraMC',
				'',
				'Welcome to the AloraMC Discord! Before you can explore our server, you must verify your Discord account with Minecraft. This ensures your identity in AloraMC is correctly reflected here!',
				'',
				"> ❕ If you have purchased rank(s), after verification they will be reflected in this Discord server — so you're always walking around in style!",
			].join('\n'),
		),
	);

	container.addSeparatorComponents(separator());

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			[
				'### Instructions',
				'1. Press the button below and copy the **verification token** it gives you',
				'2. Join our server via the IP **play.aloramc.net**',
				'3. In any server, type `/verify <token>`',
				'4. And huzzah, you are now verified! 🎉',
			].join('\n'),
		),
	);

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(VERIFY_BUTTON_ID)
			.setLabel('Verify with Minecraft')
			.setStyle(ButtonStyle.Primary)
			.setEmoji('📖'),
	);

	return { container, row };
}
