import { randomInt } from 'node:crypto';
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { container } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ContainerBuilder,
	type Guild,
	type GuildMember,
	TextDisplayBuilder,
	type User,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import { Colors, logContainer, makeContainer, spacer } from './components.js';
import { db, schema } from './database.js';
import { logFields, sendLog } from './LoggingUtil.js';
import { isModuleEnabled } from './ModuleUtil.js';
import { fetchBotMember, unsafeGrantReason } from './RoleSafety.js';

// ─── Custom IDs ────────────────────────────────────────────────────────────────

export const VERIFY_BUTTON_ID = 'verification:start';
export const CODE_BUTTON_ID = 'verification:code';
export const CODE_MODAL_ID = 'verification:modal';

// ─── Settings ──────────────────────────────────────────────────────────────────

export type VerificationSettings = typeof schema.verificationSettings.$inferSelect;
export type VerificationSettingsPatch = Partial<Omit<VerificationSettings, 'guildId'>>;

export async function getVerificationSettings(guildId: string): Promise<VerificationSettings | null> {
	const [row] = await db
		.select()
		.from(schema.verificationSettings)
		.where(eq(schema.verificationSettings.guildId, guildId))
		.limit(1);
	return row ?? null;
}

/** Insert or patch a guild's settings; fields missing from `patch` keep their stored value (or column default). */
export async function upsertVerificationSettings(
	guildId: string,
	patch: VerificationSettingsPatch,
): Promise<VerificationSettings> {
	await db
		.insert(schema.verificationSettings)
		.values({ guildId, ...patch })
		.onDuplicateKeyUpdate({ set: Object.keys(patch).length > 0 ? patch : { guildId } });
	return (await getVerificationSettings(guildId))!;
}

/** Whether verification can run here: on, off for this guild, or killed by the global module switch. */
export async function getVerificationModuleState(guildId: string): Promise<'on' | 'guild-off' | 'global-off'> {
	if (await isModuleEnabled(guildId, 'verification')) return 'on';
	const globalRow = await db.query.globalModules.findFirst({ where: eq(schema.globalModules.id, 1) });
	return globalRow?.verification === false ? 'global-off' : 'guild-off';
}

// ─── Account age ───────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** True when the account is at least `minAgeDays` old (0 disables the check). */
export function isAccountOldEnough(createdTimestamp: number, minAgeDays: number, now = Date.now()): boolean {
	if (minAgeDays <= 0) return true;
	return now - createdTimestamp >= minAgeDays * DAY_MS;
}

// ─── Captcha ───────────────────────────────────────────────────────────────────

/** Uppercase letters and digits without the look-alikes 0, O, 1, I and L. */
export const CAPTCHA_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CAPTCHA_LENGTH = 5;
export const CAPTCHA_TTL_MS = 5 * 60_000;
export const CAPTCHA_MAX_ATTEMPTS = 3;

export function generateCaptchaCode(length = CAPTCHA_LENGTH): string {
	let code = '';
	for (let i = 0; i < length; i++) code += CAPTCHA_ALPHABET[randomInt(CAPTCHA_ALPHABET.length)];
	return code;
}

const CAPTCHA_WIDTH = 300;
const CAPTCHA_HEIGHT = 110;
const CAPTCHA_FONT = '"DejaVu Sans", "Liberation Sans", Arial, sans-serif';

function randBetween(min: number, max: number): number {
	return min + Math.random() * (max - min);
}

function randomRgba(min: number, max: number, alpha: number): string {
	const channel = () => Math.round(randBetween(min, max));
	return `rgba(${channel()},${channel()},${channel()},${alpha})`;
}

function drawNoiseCurve(ctx: SKRSContext2D, alpha: number) {
	ctx.strokeStyle = randomRgba(90, 220, alpha);
	ctx.lineWidth = randBetween(1, 2.6);
	ctx.beginPath();
	ctx.moveTo(randBetween(0, 40), randBetween(0, CAPTCHA_HEIGHT));
	ctx.quadraticCurveTo(
		randBetween(80, CAPTCHA_WIDTH - 80),
		randBetween(-20, CAPTCHA_HEIGHT + 20),
		randBetween(CAPTCHA_WIDTH - 40, CAPTCHA_WIDTH),
		randBetween(0, CAPTCHA_HEIGHT),
	);
	ctx.stroke();
}

/** Render `code` as a PNG: rotated, jittered glyphs over noise lines and dots. */
export function renderCaptcha(code: string): Buffer {
	const canvas = createCanvas(CAPTCHA_WIDTH, CAPTCHA_HEIGHT);
	const ctx = canvas.getContext('2d');

	const bg = ctx.createLinearGradient(0, 0, CAPTCHA_WIDTH, CAPTCHA_HEIGHT);
	bg.addColorStop(0, '#1e2230');
	bg.addColorStop(1, '#2d2f45');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, CAPTCHA_WIDTH, CAPTCHA_HEIGHT);

	// Noise behind the glyphs.
	for (let i = 0; i < 6; i++) drawNoiseCurve(ctx, 0.55);

	// One glyph per slot, each with its own size, rotation and vertical jitter.
	const slot = CAPTCHA_WIDTH / (code.length + 1);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (let i = 0; i < code.length; i++) {
		ctx.font = `bold ${Math.round(randBetween(44, 56))}px ${CAPTCHA_FONT}`;
		ctx.fillStyle = randomRgba(185, 255, 1);
		ctx.save();
		ctx.translate(slot * (i + 1) + randBetween(-4, 4), CAPTCHA_HEIGHT / 2 + randBetween(-9, 9));
		ctx.rotate(randBetween(-0.45, 0.45));
		ctx.fillText(code[i], 0, 0);
		ctx.restore();
	}

	// Strike-through curves and speckle on top so the glyphs cannot be cleanly separated from the noise.
	for (let i = 0; i < 3; i++) drawNoiseCurve(ctx, 0.8);
	for (let i = 0; i < 140; i++) {
		ctx.fillStyle = randomRgba(120, 255, 0.7);
		ctx.fillRect(
			randBetween(0, CAPTCHA_WIDTH),
			randBetween(0, CAPTCHA_HEIGHT),
			randBetween(1, 2.5),
			randBetween(1, 2.5),
		);
	}

	return canvas.toBuffer('image/png');
}

// ─── Pending captcha codes (in memory) ─────────────────────────────────────────

interface PendingCaptcha {
	code: string;
	expiresAt: number;
	attempts: number;
}

/** Hard cap so a flood of Verify clicks cannot grow the map without bound before codes expire. */
const MAX_PENDING_CAPTCHAS = 5_000;

const pendingCaptchas = new Map<string, PendingCaptcha>();

function pendingKey(guildId: string, userId: string): string {
	return `${guildId}:${userId}`;
}

function prunePending(now: number) {
	for (const [key, entry] of pendingCaptchas) {
		if (entry.expiresAt <= now) pendingCaptchas.delete(key);
	}
	// Map iteration order is insertion order, so the oldest entries go first.
	for (const key of pendingCaptchas.keys()) {
		if (pendingCaptchas.size <= MAX_PENDING_CAPTCHAS) break;
		pendingCaptchas.delete(key);
	}
}

/** Generate a code for this member, replacing any earlier one, and hold it for five minutes. */
export function createPendingCaptcha(guildId: string, userId: string, now = Date.now()): string {
	prunePending(now);
	const code = generateCaptchaCode();
	const key = pendingKey(guildId, userId);
	pendingCaptchas.delete(key);
	pendingCaptchas.set(key, { code, expiresAt: now + CAPTCHA_TTL_MS, attempts: 0 });
	return code;
}

export function hasPendingCaptcha(guildId: string, userId: string, now = Date.now()): boolean {
	const entry = pendingCaptchas.get(pendingKey(guildId, userId));
	return !!entry && entry.expiresAt > now;
}

export type CaptchaCheck =
	| { status: 'ok' }
	/** No code on file, or it timed out. */
	| { status: 'expired' }
	| { status: 'wrong'; attemptsLeft: number }
	/** The last allowed attempt was wrong; the code is discarded. */
	| { status: 'exhausted' };

/** Compare `input` with the member's pending code (case-insensitive). A correct answer consumes the code. */
export function checkPendingCaptcha(guildId: string, userId: string, input: string, now = Date.now()): CaptchaCheck {
	const key = pendingKey(guildId, userId);
	const entry = pendingCaptchas.get(key);
	if (!entry || entry.expiresAt <= now) {
		pendingCaptchas.delete(key);
		return { status: 'expired' };
	}

	if (input.trim().toUpperCase() === entry.code) {
		pendingCaptchas.delete(key);
		return { status: 'ok' };
	}

	entry.attempts++;
	if (entry.attempts >= CAPTCHA_MAX_ATTEMPTS) {
		pendingCaptchas.delete(key);
		return { status: 'exhausted' };
	}
	return { status: 'wrong', attemptsLeft: CAPTCHA_MAX_ATTEMPTS - entry.attempts };
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export function buildVerificationPanel(): ContainerBuilder {
	const panel = makeContainer({ color: Colors.Info, header: 'Verification' });
	panel.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			"Press **Verify** to confirm you're a real member and unlock the rest of the server.",
		),
	);
	panel.addSeparatorComponents(spacer());
	panel.addActionRowComponents(
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel('Verify').setStyle(ButtonStyle.Success),
		),
	);
	return panel;
}

// ─── Logging ───────────────────────────────────────────────────────────────────

/** Send a verification entry to the general log webhook (only while the logging module is on). Never throws. */
export async function logVerification(
	guild: Guild,
	title: string,
	color: number,
	fields: Array<{ name: string; value: string }>,
	targetUser?: User,
): Promise<void> {
	try {
		if (!(await isModuleEnabled(guild.id, 'logging'))) return;
		await sendLog(guild, logContainer({ title, color, fields, timestamp: true, targetUser }));
	} catch {
		// Logging must never interrupt verification.
	}
}

// ─── Granting ──────────────────────────────────────────────────────────────────

/**
 * `unverified-role-error`: the verified role WAS given (and logged), only removing the unverified
 * role failed. The other reasons mean the member did not get the verified role.
 */
export type GrantResult =
	| { ok: true }
	| { ok: false; reason: 'role-missing' | 'role-unsafe' | 'role-error' | 'unverified-role-error' };

/**
 * Take the unverified role off a member who holds it. `failed` means the API call failed (logged);
 * `not-held` covers no unverified role being configured as well.
 */
export async function removeUnverifiedRole(
	member: GuildMember,
	settings: VerificationSettings,
): Promise<'removed' | 'not-held' | 'failed'> {
	const { unverifiedRoleId } = settings;
	if (!unverifiedRoleId || !member.roles.cache.has(unverifiedRoleId)) return 'not-held';
	try {
		await member.roles.remove(unverifiedRoleId, 'Member verification');
		return 'removed';
	} catch (err) {
		container.logger.warn(
			`[verification] Could not remove the unverified role from ${member.id} in ${member.guild.id}:`,
			err,
		);
		return 'failed';
	}
}

/**
 * Give the member the verified role, drop the unverified role when one is set, and log it.
 * The verified role is re-checked first (RoleSafety): one that has since gained staff permissions or
 * moved above the bot is not handed out. Role errors are returned, never thrown.
 */
export async function grantVerification(member: GuildMember, settings: VerificationSettings): Promise<GrantResult> {
	const { roleId } = settings;
	const role = roleId ? member.guild.roles.cache.get(roleId) : undefined;
	if (!roleId || !role) return { ok: false, reason: 'role-missing' };

	const me = await fetchBotMember(member.guild);
	const unsafe = me ? unsafeGrantReason(role, me) : "the bot's own member could not be loaded";
	if (unsafe) {
		container.logger.warn(`[verification] Not granting the verified role in ${member.guild.id}: ${unsafe}`);
		return { ok: false, reason: 'role-unsafe' };
	}

	try {
		await member.roles.add(roleId, 'Member verification');
	} catch (err) {
		container.logger.warn(`[verification] Could not update roles for ${member.id} in ${member.guild.id}:`, err);
		return { ok: false, reason: 'role-error' };
	}
	// The member is verified from here on, whatever happens to the unverified role.
	const removal = await removeUnverifiedRole(member, settings);
	const fields = [
		logFields.user(member.id),
		logFields.accountCreated(Math.floor(member.user.createdTimestamp / 1000)),
		{ name: 'Method', value: settings.captchaEnabled ? 'Captcha' : 'Button' },
		{ name: 'Role', value: `<@&${roleId}>` },
	];
	if (removal === 'failed') {
		fields.push({ name: 'Warning', value: `Could not remove the unverified role <@&${settings.unverifiedRoleId}>.` });
	}
	await logVerification(member.guild, 'Member Verified', Colors.Success, fields, member.user);

	return removal === 'failed' ? { ok: false, reason: 'unverified-role-error' } : { ok: true };
}
