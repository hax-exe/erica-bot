/** Shared helpers / tables for economy gambling games. */

export function clampBet(bet: number, max = 250_000): number {
	return Math.max(1, Math.min(Math.floor(bet), max));
}

export function rollDice(sides = 6): number {
	return Math.floor(Math.random() * sides) + 1;
}

/** Crash multiplier — house edge ~4%. Cash-out simulated instantly at a random crash point. */
export function crashPoint(): number {
	const r = Math.random();
	if (r < 0.03) return 1; // instant bust
	// e / (1-r) style curve, capped
	const point = Math.floor((0.96 / (1 - r)) * 100) / 100;
	return Math.min(point, 100);
}

export const HORSE_NAMES = ['Thunder', 'Shadowfax', 'Bolt', 'Cinder', 'Comet', 'Midnight', 'Blaze', 'Storm'] as const;

export function raceHorses(): { order: number[]; finishes: number[] } {
	// finishes[i] = "time" (lower better); random with slight variance
	const finishes = HORSE_NAMES.map(() => Math.random() + Math.random() * 0.35);
	const order = finishes.map((_, i) => i).sort((a, b) => finishes[a]! - finishes[b]!);
	return { order, finishes };
}

export const WHEEL_SLICES: { label: string; mult: number; weight: number; emoji: string }[] = [
	{ label: '×0', mult: 0, weight: 20, emoji: '💀' },
	{ label: '×0.5', mult: 0.5, weight: 18, emoji: '😐' },
	{ label: '×1', mult: 1, weight: 22, emoji: '↩️' },
	{ label: '×1.5', mult: 1.5, weight: 15, emoji: '🙂' },
	{ label: '×2', mult: 2, weight: 12, emoji: '✨' },
	{ label: '×3', mult: 3, weight: 7, emoji: '🔥' },
	{ label: '×5', mult: 5, weight: 4, emoji: '💎' },
	{ label: '×10', mult: 10, weight: 2, emoji: '👑' },
];

export function spinWheel(): (typeof WHEEL_SLICES)[number] {
	const total = WHEEL_SLICES.reduce((s, x) => s + x.weight, 0);
	let r = Math.random() * total;
	for (const slice of WHEEL_SLICES) {
		r -= slice.weight;
		if (r <= 0) return slice;
	}
	return WHEEL_SLICES[0]!;
}

/** Mines — pick cells; hit bomb = lose. Safe picks multiply. */
export function generateMinesBoard(bombs: number, size = 25): Set<number> {
	const set = new Set<number>();
	while (set.size < Math.min(bombs, size - 1)) {
		set.add(Math.floor(Math.random() * size));
	}
	return set;
}

export function minesMultiplier(picks: number, bombs: number, size = 25): number {
	// rough fair-ish rising multiplier
	let mult = 1;
	for (let i = 0; i < picks; i++) {
		const safeLeft = size - bombs - i;
		const totalLeft = size - i;
		if (safeLeft <= 0) break;
		mult *= totalLeft / safeLeft;
	}
	return Math.floor(mult * 0.97 * 100) / 100; // house edge
}

export function baccaratHand(): { cards: number[]; total: number } {
	const c1 = rollDice(13);
	const c2 = rollDice(13);
	const val = (n: number) => (n >= 10 ? 0 : n);
	const total = (val(c1) + val(c2)) % 10;
	return { cards: [c1, c2], total };
}

export function lotteryDraw(max = 50, count = 5): number[] {
	const pool = Array.from({ length: max }, (_, i) => i + 1);
	const picks: number[] = [];
	for (let i = 0; i < count; i++) {
		const idx = Math.floor(Math.random() * pool.length);
		picks.push(pool.splice(idx, 1)[0]!);
	}
	return picks.sort((a, b) => a - b);
}

export function lotteryMatches(picks: number[], draw: number[]): number {
	const set = new Set(draw);
	return picks.filter((n) => set.has(n)).length;
}

export const LOTTERY_PAYOUT: Record<number, number> = {
	0: 0,
	1: 0,
	2: 1.5,
	3: 5,
	4: 25,
	5: 200,
};
