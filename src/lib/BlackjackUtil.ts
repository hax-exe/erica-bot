import { createCanvas } from '@napi-rs/canvas';

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface BjCard {
	s: Suit;
	r: Rank;
}

export const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function buildDeck(): BjCard[] {
	return SUITS.flatMap((s) => RANKS.map((r) => ({ s, r })));
}

export function shuffleDeck<T>(arr: T[]): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

export function cardVal(r: Rank): number {
	if (r === 'A') return 11;
	if (['J', 'Q', 'K'].includes(r)) return 10;
	return Number(r);
}

export function handTotal(cards: BjCard[]): number {
	let total = cards.reduce((s, c) => s + cardVal(c.r), 0);
	let aces = cards.filter((c) => c.r === 'A').length;
	while (total > 21 && aces-- > 0) total -= 10;
	return total;
}

function isRedSuit(s: Suit): boolean {
	return s === 'H' || s === 'D';
}

/**
 * Draw a suit glyph with canvas paths — Unicode ♠♥♦♣ often missing from
 * default canvas fonts (renders as tofu / hollow boxes).
 */
function drawSuitGlyph(
	ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
	suit: Suit,
	cx: number,
	cy: number,
	size: number,
) {
	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(size / 24, size / 24);
	ctx.beginPath();

	switch (suit) {
		case 'H': // heart
			ctx.moveTo(0, 6);
			ctx.bezierCurveTo(0, 2, -8, -2, -8, -6);
			ctx.bezierCurveTo(-8, -10, -4, -12, 0, -8);
			ctx.bezierCurveTo(4, -12, 8, -10, 8, -6);
			ctx.bezierCurveTo(8, -2, 0, 2, 0, 6);
			break;
		case 'D': // diamond
			ctx.moveTo(0, -11);
			ctx.lineTo(7, 0);
			ctx.lineTo(0, 11);
			ctx.lineTo(-7, 0);
			ctx.closePath();
			break;
		case 'S': // spade
			ctx.moveTo(0, -11);
			ctx.bezierCurveTo(8, -2, 10, 2, 5, 5);
			ctx.bezierCurveTo(3, 6, 2, 6, 2, 7);
			ctx.lineTo(4, 11);
			ctx.lineTo(-4, 11);
			ctx.lineTo(-2, 7);
			ctx.bezierCurveTo(-2, 6, -3, 6, -5, 5);
			ctx.bezierCurveTo(-10, 2, -8, -2, 0, -11);
			break;
		case 'C': {
			// Three lobes + stem (drawn as separate filled shapes)
			ctx.arc(0, -7, 5.2, 0, Math.PI * 2);
			ctx.arc(-5.5, 1, 5.2, 0, Math.PI * 2);
			ctx.arc(5.5, 1, 5.2, 0, Math.PI * 2);
			ctx.moveTo(-2.2, 4);
			ctx.lineTo(-3.5, 12);
			ctx.lineTo(3.5, 12);
			ctx.lineTo(2.2, 4);
			ctx.closePath();
			break;
		}
	}

	ctx.fill();
	ctx.restore();
}

export function drawCard(ctx: any, x: number, y: number, card: BjCard, isHidden: boolean) {
	const w = 55;
	const h = 80;
	const r = 5; // corner radius

	// Card background
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.arcTo(x + w, y, x + w, y + r, r);
	ctx.lineTo(x + w, y + h - r);
	ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
	ctx.lineTo(x + r, y + h);
	ctx.arcTo(x, y + h, x, y + h - r, r);
	ctx.lineTo(x, y + r);
	ctx.arcTo(x, y, x + r, y, r);
	ctx.closePath();

	if (isHidden) {
		ctx.fillStyle = '#ef4444';
		ctx.fill();
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 2;
		ctx.stroke();

		ctx.strokeStyle = '#b91c1c';
		ctx.lineWidth = 1;
		ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
	} else {
		ctx.fillStyle = '#ffffff';
		ctx.fill();
		ctx.strokeStyle = '#cccccc';
		ctx.lineWidth = 1;
		ctx.stroke();

		const color = isRedSuit(card.s) ? '#dc2626' : '#1d1d1f';
		ctx.fillStyle = color;

		// Rank (top-left)
		ctx.font = 'bold 16px sans-serif';
		ctx.textAlign = 'left';
		ctx.textBaseline = 'top';
		ctx.fillText(card.r, x + 4, y + 4);

		// Small suit under rank
		drawSuitGlyph(ctx, card.s, x + 12, y + 28, 12);

		// Center suit
		drawSuitGlyph(ctx, card.s, x + w / 2, y + h / 2 + 4, 26);

		// Bottom-right suit (mirrored placement)
		drawSuitGlyph(ctx, card.s, x + w - 12, y + h - 14, 12);
	}
}

export function drawBlackjackBoard(player: BjCard[], dealer: BjCard[], hideDealer: boolean): Buffer {
	const canvas = createCanvas(500, 300);
	const ctx = canvas.getContext('2d');

	ctx.fillStyle = '#0b5c2c';
	ctx.fillRect(0, 0, 500, 300);

	ctx.strokeStyle = '#053e1d';
	ctx.lineWidth = 10;
	ctx.strokeRect(5, 5, 490, 290);
	ctx.strokeStyle = '#d4af37';
	ctx.lineWidth = 2;
	ctx.strokeRect(12, 12, 476, 276);

	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 18px sans-serif';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';

	const dealerTotalText = hideDealer ? '' : ` (${handTotal(dealer)})`;
	ctx.fillText(`Dealer's Hand${dealerTotalText}`, 40, 20);
	ctx.fillText(`Your Hand (${handTotal(player)})`, 40, 150);

	for (let i = 0; i < dealer.length; i++) {
		const card = dealer[i];
		const isHidden = hideDealer && i === 0;
		drawCard(ctx, 40 + i * 65, 45, card, isHidden);
	}

	for (let i = 0; i < player.length; i++) {
		drawCard(ctx, 40 + i * 65, 175, player[i], false);
	}

	return canvas.toBuffer('image/png');
}
