import { createCanvas, GlobalFonts, type Image, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

// ─── Fonts ────────────────────────────────────────────────────────────────────
GlobalFonts.registerFromPath('./assets/fonts/Minecraft-Seven_v2.ttf', 'MCseven');
GlobalFonts.registerFromPath('./assets/fonts/Minecraft-Tenv2.ttf', 'MCten');
GlobalFonts.registerFromPath('./assets/fonts/MinecraftFive-Regular.ttf', 'MCfive');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function safeLoadImage(url: string) {
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const buf = Buffer.from(await res.arrayBuffer());
		return await loadImage(buf);
	} catch {
		return null;
	}
}

function hexToRgba(hex: string, alpha: number): string {
	const cleaned = hex.replace('#', '');
	const full = cleaned.length === 3 ? cleaned.replace(/(.)/g, '$1$1') : cleaned;
	const n = parseInt(full, 16);
	if (Number.isNaN(n)) return `rgba(88,101,242,${alpha})`;
	return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function coverImage(ctx: SKRSContext2D, img: Image, x: number, y: number, w: number, h: number) {
	const imgRatio = img.width / img.height;
	const boxRatio = w / h;
	let drawW = w;
	let drawH = h;
	let drawX = x;
	let drawY = y;

	if (imgRatio > boxRatio) {
		drawW = h * imgRatio;
		drawX = x + (w - drawW) / 2;
	} else {
		drawH = w / imgRatio;
		drawY = y + (h - drawH) / 2;
	}
	ctx.drawImage(img, drawX, drawY, drawW, drawH);
}

function roundRectPath(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

/** Soft frosted plate for text/controls over busy backgrounds. */
function fillGlass(
	ctx: SKRSContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	fill = 'rgba(12,14,20,0.45)',
	stroke = 'rgba(255,255,255,0.10)',
) {
	roundRectPath(ctx, x, y, w, h, r);
	ctx.fillStyle = fill;
	ctx.fill();
	ctx.strokeStyle = stroke;
	ctx.lineWidth = 1.5 * S;
	ctx.stroke();
}

// ─── Rank Card ────────────────────────────────────────────────────────────────
// Rendered at 2× (2000×600) for sharpness.

const S = 2;
const W = 1000 * S;
const H = 300 * S;
const CARD_R = 28 * S;

const AV_SIZE = 174 * S;
const AV_X = 42 * S;
const AV_Y = (H - AV_SIZE) / 2;
const AV_R = AV_SIZE / 2;

const CONTENT_X = AV_X + AV_SIZE + 38 * S;
const CONTENT_R = W - 38 * S;
const CONTENT_W = CONTENT_R - CONTENT_X;

const NAME_Y = 119 * S;
const USER_Y = 148 * S;
const BAR_Y = 226 * S;
const BAR_H = 12 * S;

const FS_NAME = 34 * S;
const FS_USER = 15 * S;
const FS_XP = 12 * S;
const FS_LVL_NUM = 30 * S;
const FS_LVL_LBL = 10 * S;
const FS_RANK = 30 * S;

const SANS = '"Segoe UI", "Helvetica Neue", "Arial", "Liberation Sans", sans-serif';

export const PRESET_BACKGROUNDS: Record<string, string> = {
	cyberpunk: 'https://images.unsplash.com/photo-1578894381163-e72c17f2d45f?w=1000&q=80',
	galaxy: 'https://images.unsplash.com/photo-1538370965046-79c0d6907d47?w=1000&q=80',
	minecraft: 'https://images.unsplash.com/photo-1607988795691-3d0147b43231?w=1000&q=80',
	sunset: 'https://images.unsplash.com/photo-1472214222541-d510753a8707?w=1000&q=80',
};

export interface RankCardOptions {
	displayName: string;
	username: string;
	avatarURL: string;
	rank: number;
	level: number;
	currentXp: number;
	xpNeeded: number;
	accentColor?: string | null;
	backgroundType?: 'color' | 'image' | 'preset';
	backgroundValue?: string | null;
}

export async function renderRankCard(opts: RankCardOptions): Promise<Buffer> {
	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	const accentHex =
		opts.accentColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(opts.accentColor) ? opts.accentColor : '#5865F2';

	let bgImgUrl: string | null = null;
	if (opts.backgroundType === 'preset' && opts.backgroundValue) {
		bgImgUrl = PRESET_BACKGROUNDS[opts.backgroundValue] ?? null;
	} else if (opts.backgroundType === 'image' && opts.backgroundValue) {
		bgImgUrl = opts.backgroundValue;
	}
	const bgImg = bgImgUrl ? await safeLoadImage(bgImgUrl) : null;

	const progress = opts.xpNeeded > 0 ? Math.min(Math.max(opts.currentXp / opts.xpNeeded, 0), 1) : 0;
	const progressPct = Math.round(progress * 100);

	// Clip the whole composition to the card.
	roundRectPath(ctx, 0, 0, W, H, CARD_R);
	ctx.clip();

	// ── Background ──
	if (bgImg) {
		ctx.save();
		ctx.filter = `blur(${18 * S}px) saturate(1.12)`;
		const inflate = 42 * S;
		coverImage(ctx, bgImg, -inflate, -inflate, W + inflate * 2, H + inflate * 2);
		ctx.filter = 'none';
		ctx.restore();

		const frost = ctx.createLinearGradient(0, 0, W, H);
		frost.addColorStop(0, 'rgba(7,9,15,0.42)');
		frost.addColorStop(0.48, 'rgba(9,11,18,0.54)');
		frost.addColorStop(1, 'rgba(5,7,12,0.68)');
		ctx.fillStyle = frost;
		ctx.fillRect(0, 0, W, H);
	} else {
		const base = opts.backgroundType === 'color' && opts.backgroundValue ? opts.backgroundValue : '#12141a';
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, W, H);

		const glow = ctx.createRadialGradient(0, H / 2, 0, 0, H / 2, W * 0.55);
		glow.addColorStop(0, hexToRgba(accentHex, 0.22));
		glow.addColorStop(1, 'rgba(0,0,0,0)');
		ctx.fillStyle = glow;
		ctx.fillRect(0, 0, W, H);

		const topSheen = ctx.createLinearGradient(0, 0, 0, H);
		topSheen.addColorStop(0, 'rgba(255,255,255,0.04)');
		topSheen.addColorStop(0.4, 'rgba(255,255,255,0)');
		ctx.fillStyle = topSheen;
		ctx.fillRect(0, 0, W, H);
	}

	// Ambient accent bloom.
	const bloom = ctx.createRadialGradient(AV_X + AV_SIZE / 2, H / 2, 0, AV_X + AV_SIZE / 2, H / 2, 280 * S);
	bloom.addColorStop(0, hexToRgba(accentHex, 0.22));
	bloom.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = bloom;
	ctx.fillRect(0, 0, W, H);

	// Accent edge.
	ctx.fillStyle = accentHex;
	ctx.fillRect(0, 0, 4 * S, H);
	ctx.fillStyle = hexToRgba(accentHex, 0.25);
	ctx.fillRect(4 * S, 0, 10 * S, H);

	// A restrained glass surface; the background remains visible.
	const panelX = CONTENT_X - 22 * S;
	const panelY = 28 * S;
	const panelW = CONTENT_R - panelX;
	const panelH = H - 56 * S;
	fillGlass(ctx, panelX, panelY, panelW, panelH, 22 * S, 'rgba(8,10,16,0.38)', 'rgba(255,255,255,0.11)');

	// Fine highlight along the top of the glass.
	ctx.beginPath();
	ctx.moveTo(panelX + 22 * S, panelY + S);
	ctx.lineTo(panelX + panelW - 22 * S, panelY + S);
	ctx.strokeStyle = 'rgba(255,255,255,0.10)';
	ctx.lineWidth = S;
	ctx.stroke();

	// ── Avatar ──
	ctx.save();
	ctx.shadowColor = 'rgba(0,0,0,0.65)';
	ctx.shadowBlur = 30 * S;
	ctx.shadowOffsetY = 10 * S;
	roundRectPath(ctx, AV_X, AV_Y, AV_SIZE, AV_SIZE, AV_R);
	ctx.fillStyle = '#1a1d24';
	ctx.fill();
	ctx.restore();

	const avatarImg = await safeLoadImage(opts.avatarURL);
	ctx.save();
	roundRectPath(ctx, AV_X, AV_Y, AV_SIZE, AV_SIZE, AV_R);
	ctx.clip();
	if (avatarImg) {
		coverImage(ctx, avatarImg, AV_X, AV_Y, AV_SIZE, AV_SIZE);
	} else {
		ctx.fillStyle = '#21262d';
		ctx.fillRect(AV_X, AV_Y, AV_SIZE, AV_SIZE);
	}
	ctx.restore();

	roundRectPath(ctx, AV_X, AV_Y, AV_SIZE, AV_SIZE, AV_R);
	ctx.strokeStyle = '#ffffff';
	ctx.lineWidth = 4 * S;
	ctx.stroke();
	roundRectPath(ctx, AV_X - 4 * S, AV_Y - 4 * S, AV_SIZE + 8 * S, AV_SIZE + 8 * S, AV_R + 4 * S);
	ctx.strokeStyle = hexToRgba(accentHex, 0.95);
	ctx.lineWidth = 3 * S;
	ctx.stroke();

	ctx.textBaseline = 'alphabetic';

	// Eyebrow adds structure and avoids a floating name.
	ctx.font = `700 ${10 * S}px ${SANS}`;
	ctx.fillStyle = hexToRgba(accentHex, 0.95);
	ctx.fillText('ALORAMC  /  MEMBER PROFILE', CONTENT_X, 70 * S);

	// ── Display name ──
	const statW = 100 * S;
	const statGap = 12 * S;
	const statStartX = CONTENT_R - statW * 2 - statGap;
	const nameMaxW = statStartX - CONTENT_X - 24 * S;
	ctx.font = `700 ${FS_NAME}px ${SANS}`;
	ctx.fillStyle = '#ffffff';
	ctx.fillText(opts.displayName, CONTENT_X, NAME_Y, nameMaxW);

	// ── Username ──
	ctx.font = `400 ${FS_USER}px ${SANS}`;
	ctx.fillStyle = 'rgba(180,190,205,0.75)';
	const handle = `@${opts.username}`;
	ctx.fillText(handle, CONTENT_X, USER_Y);

	// ── Rank + level stat tiles ──
	const statY = 58 * S;
	const statH = 92 * S;
	const rankValue = opts.rank > 0 && opts.rank < 999 ? `#${opts.rank}` : '—';
	const stats = [
		{ label: 'SERVER RANK', value: rankValue },
		{ label: 'LEVEL', value: String(opts.level) },
	];
	for (let i = 0; i < stats.length; i++) {
		const x = statStartX + i * (statW + statGap);
		fillGlass(
			ctx,
			x,
			statY,
			statW,
			statH,
			14 * S,
			i === 1 ? hexToRgba(accentHex, 0.15) : 'rgba(255,255,255,0.045)',
			i === 1 ? hexToRgba(accentHex, 0.45) : 'rgba(255,255,255,0.10)',
		);
		ctx.textAlign = 'center';
		ctx.font = `700 ${FS_LVL_LBL}px ${SANS}`;
		ctx.fillStyle = 'rgba(190,200,216,0.65)';
		ctx.fillText(stats[i].label, x + statW / 2, statY + 24 * S);
		ctx.font = `700 ${i === 0 ? FS_RANK : FS_LVL_NUM}px ${SANS}`;
		ctx.fillStyle = '#ffffff';
		ctx.fillText(stats[i].value, x + statW / 2, statY + 67 * S);
	}
	ctx.textAlign = 'left';

	// ── XP progress ──
	const barW = CONTENT_W;
	ctx.font = `700 ${FS_XP}px ${SANS}`;
	ctx.fillStyle = 'rgba(220,226,236,0.88)';
	ctx.fillText('LEVEL PROGRESS', CONTENT_X, BAR_Y - 20 * S);

	ctx.font = `600 ${FS_XP}px ${SANS}`;
	ctx.textAlign = 'right';
	ctx.fillStyle = '#ffffff';
	ctx.fillText(`${progressPct}%`, CONTENT_R, BAR_Y - 20 * S);

	roundRectPath(ctx, CONTENT_X, BAR_Y, barW, BAR_H, BAR_H / 2);
	ctx.fillStyle = 'rgba(0,0,0,0.44)';
	ctx.fill();
	ctx.strokeStyle = 'rgba(255,255,255,0.08)';
	ctx.lineWidth = 1 * S;
	ctx.stroke();

	if (progress > 0) {
		const fillW = Math.max(barW * progress, BAR_H);
		ctx.save();
		roundRectPath(ctx, CONTENT_X, BAR_Y, barW, BAR_H, BAR_H / 2);
		ctx.clip();

		const grad = ctx.createLinearGradient(CONTENT_X, BAR_Y, CONTENT_X + fillW, BAR_Y);
		grad.addColorStop(0, hexToRgba(accentHex, 0.85));
		grad.addColorStop(1, accentHex);
		ctx.fillStyle = grad;
		ctx.fillRect(CONTENT_X, BAR_Y, fillW, BAR_H);

		ctx.fillStyle = 'rgba(255,255,255,0.22)';
		ctx.fillRect(CONTENT_X, BAR_Y, fillW, BAR_H * 0.45);
		ctx.restore();
	}

	const xpText = `${opts.currentXp.toLocaleString()} / ${opts.xpNeeded.toLocaleString()} XP`;
	ctx.font = `500 ${FS_XP}px ${SANS}`;
	ctx.textAlign = 'right';
	ctx.fillStyle = 'rgba(190,200,216,0.62)';
	ctx.fillText(xpText, CONTENT_R, BAR_Y + 32 * S);
	ctx.textAlign = 'left';

	// Outer rim.
	roundRectPath(ctx, 1 * S, 1 * S, W - 2 * S, H - 2 * S, CARD_R - S);
	ctx.strokeStyle = 'rgba(255,255,255,0.12)';
	ctx.lineWidth = 1.5 * S;
	ctx.stroke();

	return canvas.toBuffer('image/png');
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

const LB_S = 2;
const LB_W = 720 * LB_S;
const LB_ROW_H = 70 * LB_S;
const LB_PAD = 20 * LB_S;
const LB_HEADER_H = 80 * LB_S;

export interface LeaderboardEntry {
	rank: number;
	userId: string;
	displayName: string;
	avatarURL: string;
	level: number;
	totalXp: number;
	currentXp: number;
	xpNeeded: number;
}

const ACCENT_COLORS = ['#FFD700', '#C0C0C0', '#CD7F32'];

export async function renderLeaderboard(entries: LeaderboardEntry[], guildName: string): Promise<Buffer> {
	const H = LB_PAD + LB_HEADER_H + LB_PAD / 2 + entries.length * LB_ROW_H + LB_PAD;
	const canvas = createCanvas(LB_W, H);
	const ctx = canvas.getContext('2d');

	ctx.fillStyle = '#0d1117';
	ctx.fillRect(0, 0, LB_W, H);

	ctx.beginPath();
	ctx.roundRect(LB_PAD, LB_PAD, LB_W - LB_PAD * 2, LB_HEADER_H, 12 * LB_S);
	ctx.fillStyle = '#161b22';
	ctx.fill();

	ctx.beginPath();
	ctx.roundRect(LB_PAD, LB_PAD, LB_W - LB_PAD * 2, 5 * LB_S, [12 * LB_S, 12 * LB_S, 0, 0]);
	ctx.fillStyle = '#5865F2';
	ctx.fill();

	ctx.textAlign = 'center';
	ctx.font = `700 ${26 * LB_S}px ${SANS}`;
	ctx.fillStyle = '#f0f6fc';
	ctx.fillText('LEADERBOARD', LB_W / 2, LB_PAD + LB_HEADER_H / 2 + 8 * LB_S);
	ctx.font = `400 ${13 * LB_S}px ${SANS}`;
	ctx.fillStyle = 'rgba(139,148,158,0.8)';
	ctx.fillText(guildName, LB_W / 2, LB_PAD + LB_HEADER_H / 2 + 28 * LB_S);
	ctx.textAlign = 'left';

	const rowsY = LB_PAD + LB_HEADER_H + LB_PAD / 2;

	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		const y = rowsY + i * LB_ROW_H;
		const rowX = LB_PAD;
		const rowW = LB_W - LB_PAD * 2;
		const accent = ACCENT_COLORS[i] ?? '#5865F2';

		ctx.beginPath();
		ctx.roundRect(rowX, y + 3 * LB_S, rowW, LB_ROW_H - 6 * LB_S, 10 * LB_S);
		ctx.fillStyle = i % 2 === 0 ? '#161b22' : '#0d1117';
		ctx.fill();

		ctx.beginPath();
		ctx.roundRect(rowX, y + 3 * LB_S, 4 * LB_S, LB_ROW_H - 6 * LB_S, [10 * LB_S, 0, 0, 10 * LB_S]);
		ctx.fillStyle = accent;
		ctx.fill();

		ctx.textAlign = 'center';
		ctx.font = `700 ${18 * LB_S}px ${SANS}`;
		ctx.fillStyle = accent;
		ctx.fillText(`#${e.rank}`, rowX + 28 * LB_S, y + LB_ROW_H / 2 + 7 * LB_S);
		ctx.textAlign = 'left';

		const avR = 20 * LB_S;
		const avX = rowX + 56 * LB_S;
		const avY = y + (LB_ROW_H - avR * 2) / 2;
		const avatarImg = await safeLoadImage(e.avatarURL);
		ctx.save();
		ctx.beginPath();
		ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
		ctx.clip();
		if (avatarImg) {
			ctx.drawImage(avatarImg, avX, avY, avR * 2, avR * 2);
		} else {
			ctx.fillStyle = '#21262d';
			ctx.fill();
		}
		ctx.restore();

		const nameX = avX + avR * 2 + 12 * LB_S;
		ctx.font = `700 ${16 * LB_S}px ${SANS}`;
		ctx.fillStyle = '#f0f6fc';
		ctx.fillText(e.displayName, nameX, y + LB_ROW_H / 2 + 1 * LB_S, 200 * LB_S);

		const lvlText = `Lv. ${e.level}`;
		ctx.font = `600 ${12 * LB_S}px ${SANS}`;
		const lvlW = ctx.measureText(lvlText).width;
		const tagPad = 6 * LB_S;
		const tagH = 18 * LB_S;
		const tagX = nameX;
		const tagY = y + LB_ROW_H / 2 + 8 * LB_S;
		ctx.beginPath();
		ctx.roundRect(tagX, tagY, lvlW + tagPad * 2, tagH, 4 * LB_S);
		ctx.fillStyle = hexToRgba(accent, 0.15);
		ctx.fill();
		ctx.fillStyle = hexToRgba(accent, 0.9);
		ctx.fillText(lvlText, tagX + tagPad, tagY + tagH - 4 * LB_S);

		ctx.textAlign = 'right';
		ctx.font = `700 ${16 * LB_S}px ${SANS}`;
		ctx.fillStyle = '#f0f6fc';
		ctx.fillText(`${e.totalXp.toLocaleString()} XP`, rowX + rowW - 14 * LB_S, y + LB_ROW_H / 2 + 6 * LB_S);
		ctx.textAlign = 'left';
	}

	return canvas.toBuffer('image/png');
}
