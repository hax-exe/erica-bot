import { randomBytes } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import { pendingVerifications } from '../db/schema.js';
import { getMinecraftServerAddress } from './brand.js';
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
	const serverAddress = getMinecraftServerAddress();

	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			[
				'### 📖 Verify your account',
				'',
				'Welcome! Before you can explore the server, you must verify your Discord account with Minecraft. This ensures your in-game identity is correctly reflected here!',
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
				serverAddress ? `2. Join our Minecraft server via the IP **${serverAddress}**` : '2. Join our Minecraft server',
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
