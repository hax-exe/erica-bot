import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from './database.js';

// ─── Shop items ────────────────────────────────────────────────────────────────

export const PREDEFINED_SHOP_ITEMS: ReadonlyArray<{
	name: string;
	description: string;
	cost: number;
	type: 'consumable';
	itemKey: string;
	durationHours: number | null;
}> = [
	{
		name: 'Padlock',
		description: 'Protects your wallet from robbery for 24 hours.',
		cost: 500,
		type: 'consumable',
		itemKey: 'padlock',
		durationHours: 24,
	},
	{
		name: 'Bank Upgrade',
		description: 'Permanently increases your bank capacity by 5,000 coins.',
		cost: 3000,
		type: 'consumable',
		itemKey: 'bank_upgrade',
		durationHours: null,
	},
	{
		name: 'Heist Kit',
		description: 'Your next /economy earn crime attempt has a 75% success rate instead of 50%.',
		cost: 1200,
		type: 'consumable',
		itemKey: 'heist_kit',
		durationHours: null,
	},
	{
		name: 'Lucky Charm',
		description: '+50% bonus on your next /daily claim.',
		cost: 500,
		type: 'consumable',
		itemKey: 'lucky_charm',
		durationHours: null,
	},
	{
		name: 'Streak Freeze',
		description: 'Preserves your daily streak if you miss a day.',
		cost: 800,
		type: 'consumable',
		itemKey: 'streak_freeze',
		durationHours: null,
	},
	{
		name: 'Work Boost',
		description: '2× work earnings for 12 hours.',
		cost: 2000,
		type: 'consumable',
		itemKey: 'work_boost',
		durationHours: 12,
	},
	{
		name: 'Cyberpunk Background Card',
		description: 'Unlocks the Cyberpunk preset background for your /rank card.',
		cost: 500,
		type: 'consumable',
		itemKey: 'bg_cyberpunk',
		durationHours: null,
	},
	{
		name: 'Galaxy Background Card',
		description: 'Unlocks the Galaxy preset background for your /rank card.',
		cost: 500,
		type: 'consumable',
		itemKey: 'bg_galaxy',
		durationHours: null,
	},
	{
		name: 'Minecraft Background Card',
		description: 'Unlocks the Minecraft preset background for your /rank card.',
		cost: 500,
		type: 'consumable',
		itemKey: 'bg_minecraft',
		durationHours: null,
	},
	{
		name: 'Sunset Background Card',
		description: 'Unlocks the Sunset preset background for your /rank card.',
		cost: 500,
		type: 'consumable',
		itemKey: 'bg_sunset',
		durationHours: null,
	},
	{
		name: 'Custom Image URL Background Card',
		description: 'Unlocks the ability to set any custom image URL background for your /rank card.',
		cost: 2000,
		type: 'consumable',
		itemKey: 'bg_custom_url',
		durationHours: null,
	},
	{
		name: 'Robbery Shield',
		description: 'Blocks the next successful rob against you (consumed on block).',
		cost: 1500,
		type: 'consumable',
		itemKey: 'robbery_shield',
		durationHours: null,
	},
	{
		name: 'Double XP Token',
		description: 'Cosmetic flex item — shows you mean business (collectible for now).',
		cost: 2500,
		type: 'consumable',
		itemKey: 'xp_token',
		durationHours: null,
	},
	{
		name: 'Loot Crate',
		description: 'Open for a random coin payout (500–4000).',
		cost: 1800,
		type: 'consumable',
		itemKey: 'loot_crate',
		durationHours: null,
	},
	{
		name: 'Mega Crate',
		description: 'Open for a huge random payout (2,000–15,000).',
		cost: 7500,
		type: 'consumable',
		itemKey: 'mega_crate',
		durationHours: null,
	},
	{
		name: "Gambler's Dice",
		description: '+25% net winnings on your next /gamble win (consumed on win).',
		cost: 2200,
		type: 'consumable',
		itemKey: 'gamblers_dice',
		durationHours: null,
	},
	{
		name: 'Loaded Coin',
		description: 'Next /gamble classic coinflip is forced heads if you pick heads (one use).',
		cost: 3500,
		type: 'consumable',
		itemKey: 'loaded_coin',
		durationHours: null,
	},
	{
		name: 'Insurance Policy',
		description: 'Refunds 50% of your next gambling loss (auto-consumes).',
		cost: 4000,
		type: 'consumable',
		itemKey: 'insurance',
		durationHours: null,
	},
	{
		name: 'Golden Hook',
		description: 'Next /economy earn fish is guaranteed a rare+ catch.',
		cost: 2800,
		type: 'consumable',
		itemKey: 'golden_hook',
		durationHours: null,
	},
	{
		name: 'Diamond Pick',
		description: 'Next /economy earn mine is guaranteed a rare+ ore.',
		cost: 2800,
		type: 'consumable',
		itemKey: 'diamond_pick',
		durationHours: null,
	},
	{
		name: 'Beg Bowl',
		description: 'Doubles your next /economy earn scavenge beg payout.',
		cost: 600,
		type: 'consumable',
		itemKey: 'beg_bowl',
		durationHours: null,
	},
	{
		name: 'Vault Expansion',
		description: 'Permanently increases bank capacity by 15,000 coins.',
		cost: 12_000,
		type: 'consumable',
		itemKey: 'vault_expansion',
		durationHours: null,
	},
	{
		name: 'Crime Spree',
		description: 'Next /economy earn crime attempt has +20% success (consumed on use).',
		cost: 4500,
		type: 'consumable',
		itemKey: 'crime_spree',
		durationHours: null,
	},
	{
		name: 'Jackpot Ticket',
		description: 'Scratch for a chance at 50×–200× the ticket cost.',
		cost: 5000,
		type: 'consumable',
		itemKey: 'jackpot_ticket',
		durationHours: null,
	},
	{
		name: 'VIP Pass',
		description: 'Flex collectible — proves you burned coins for status.',
		cost: 25_000,
		type: 'consumable',
		itemKey: 'vip_pass',
		durationHours: null,
	},
];

export async function ensureShopSeeded(guildId: string): Promise<void> {
	for (const item of PREDEFINED_SHOP_ITEMS) {
		await db
			.insert(schema.shopItems)
			.values({ guildId, ...item })
			.onDuplicateKeyUpdate({ set: { name: sql`${schema.shopItems.name}` } });
	}
}

// ─── Constants ─────────────────────────────────────────────────────────────────

export const CURRENCY = '🪙';
export const DEFAULT_BANK_CAP = 10_000;

export const DAILY_MIN = 250;
export const DAILY_MAX = 650;
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const STREAK_GRACE_MS = 48 * 60 * 60 * 1000;
export const MAX_STREAK = 14;

export const WEEKLY_MIN = 2500;
export const WEEKLY_MAX = 7000;
export const MONTHLY_MIN = 12_000;
export const MONTHLY_MAX = 35_000;

export const WORK_MIN = 200;
export const WORK_MAX = 550;
export const WORK_COOLDOWN_MS = 3 * 60 * 60 * 1000;

export const CRIME_SUCCESS_MIN = 300;
export const CRIME_SUCCESS_MAX = 900;
export const CRIME_FAIL_MIN = 120;
export const CRIME_FAIL_MAX = 400;
export const CRIME_COOLDOWN_MS = 90 * 60 * 1000;
export const CRIME_SUCCESS_RATE = 0.5;

export const SCAVENGE_COOLDOWN_MS = 15 * 60 * 1000;
export const BEG_MIN = 5;
export const BEG_MAX = 120;
export const HUNT_MIN = 40;
export const HUNT_MAX = 350;
export const DIG_MIN = 20;
export const DIG_MAX = 280;

export const ROB_COOLDOWN_MS = 60 * 60 * 1000;
export const ROB_MIN_TARGET_WALLET = 200;
export const ROB_MIN_ROBBER_WALLET = 50;
export const ROB_SUCCESS_RATE = 0.4;
export const ROB_STEAL_MIN = 0.1;
export const ROB_STEAL_MAX = 0.3;
export const ROB_FINE_PERCENT = 0.25;

export const FISH_COOLDOWN_MS = 30 * 60 * 1000;
export const MINE_COOLDOWN_MS = 45 * 60 * 1000;

// ─── Loot tiers ────────────────────────────────────────────────────────────────

export interface LootTier {
	name: string;
	emoji: string;
	min: number;
	max: number;
	weight: number;
	rare?: boolean;
}

export const FISH_TIERS: LootTier[] = [
	{ name: 'Old Boot', emoji: '🥾', min: 0, max: 0, weight: 8 },
	{ name: 'Tiny Fish', emoji: '🐟', min: 40, max: 100, weight: 32 },
	{ name: 'Bass', emoji: '🐠', min: 100, max: 220, weight: 26 },
	{ name: 'Salmon', emoji: '🐡', min: 200, max: 380, weight: 16 },
	{ name: 'Tuna', emoji: '🎣', min: 380, max: 750, weight: 10 },
	{ name: 'Treasure Chest', emoji: '📦', min: 800, max: 2000, weight: 5, rare: true },
	{ name: 'Legendary Fish', emoji: '✨', min: 2500, max: 7000, weight: 2, rare: true },
	{ name: 'Leviathan', emoji: '🐉', min: 8000, max: 20_000, weight: 1, rare: true },
];

export const MINE_TIERS: LootTier[] = [
	{ name: 'Dirt', emoji: '🟫', min: 0, max: 0, weight: 12 },
	{ name: 'Gravel', emoji: '🪨', min: 15, max: 40, weight: 14 },
	{ name: 'Coal', emoji: '⬛', min: 50, max: 110, weight: 26 },
	{ name: 'Iron', emoji: '⚙️', min: 110, max: 220, weight: 20 },
	{ name: 'Gold', emoji: '🟡', min: 220, max: 420, weight: 14 },
	{ name: 'Diamond', emoji: '💎', min: 500, max: 1200, weight: 9, rare: true },
	{ name: 'Netherite', emoji: '⬛', min: 1400, max: 3500, weight: 4, rare: true },
	{ name: 'Ancient Debris Vein', emoji: '☄️', min: 5000, max: 15_000, weight: 1, rare: true },
];

export const HUNT_TIERS: LootTier[] = [
	{ name: 'Nothing', emoji: '🍂', min: 0, max: 0, weight: 15 },
	{ name: 'Rabbit', emoji: '🐇', min: 40, max: 100, weight: 30 },
	{ name: 'Deer', emoji: '🦌', min: 100, max: 250, weight: 25 },
	{ name: 'Boar', emoji: '🐗', min: 200, max: 450, weight: 18 },
	{ name: 'Wolf Pelt', emoji: '🐺', min: 400, max: 900, weight: 8, rare: true },
	{ name: 'Dragon Scale', emoji: '🐲', min: 2000, max: 8000, weight: 2, rare: true },
];

export const DIG_TIERS: LootTier[] = [
	{ name: 'Worms', emoji: '🪱', min: 0, max: 10, weight: 20 },
	{ name: 'Bottle Cap', emoji: '🧢', min: 20, max: 60, weight: 28 },
	{ name: 'Silver Coin', emoji: '🪙', min: 60, max: 160, weight: 25 },
	{ name: 'Relic', emoji: '🏺', min: 160, max: 400, weight: 15 },
	{ name: 'Buried Cache', emoji: '🗺️', min: 500, max: 1500, weight: 9, rare: true },
	{ name: 'Pirate Gold', emoji: '🏴‍☠️', min: 2500, max: 10_000, weight: 3, rare: true },
];

/** Pick a random tier using weighted probability. */
export function pickTier(tiers: LootTier[]): LootTier {
	const total = tiers.reduce((s, t) => s + t.weight, 0);
	let r = Math.random() * total;
	for (const tier of tiers) {
		r -= tier.weight;
		if (r <= 0) return tier;
	}
	return tiers[tiers.length - 1];
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TxType =
	| 'daily'
	| 'pay_sent'
	| 'pay_received'
	| 'shop_buy'
	| 'work'
	| 'crime'
	| 'rob_taken'
	| 'rob_lost'
	| 'slots_win'
	| 'slots_loss'
	| 'coinflip_win'
	| 'coinflip_loss'
	| 'blackjack_win'
	| 'blackjack_loss'
	| 'blackjack_tie'
	| 'deposit'
	| 'withdraw'
	| 'fish'
	| 'mine'
	| 'duel_win'
	| 'duel_loss'
	| 'admin_add'
	| 'admin_remove'
	| 'admin_reset'
	| 'weekly'
	| 'monthly'
	| 'roulette_win'
	| 'roulette_loss'
	| 'scratch_win'
	| 'scratch_loss'
	| 'loot_crate'
	| 'mega_crate'
	| 'jackpot_ticket'
	| 'scavenge'
	| 'gamble_win'
	| 'gamble_loss'
	| 'dice_win'
	| 'dice_loss'
	| 'rps_win'
	| 'rps_loss'
	| 'crash_win'
	| 'crash_loss'
	| 'horse_win'
	| 'horse_loss'
	| 'lottery_win'
	| 'lottery_loss'
	| 'mines_win'
	| 'mines_loss'
	| 'wheel_win'
	| 'wheel_loss'
	| 'highlow_win'
	| 'highlow_loss'
	| 'baccarat_win'
	| 'baccarat_loss'
	| 'poker_win'
	| 'poker_loss'
	| 'plinko_win'
	| 'plinko_loss'
	| 'keno_win'
	| 'keno_loss'
	| 'limbo_win'
	| 'limbo_loss'
	| 'war_win'
	| 'war_loss'
	| 'sicbo_win'
	| 'sicbo_loss'
	| 'tower_win'
	| 'tower_loss';

// ─── Row helpers ───────────────────────────────────────────────────────────────

function normaliseEconRow<T extends { bank: unknown; bankCap: unknown; dailyStreak: unknown }>(row: T) {
	return {
		...row,
		bank: typeof row.bank === 'number' ? row.bank : 0,
		bankCap: typeof row.bankCap === 'number' ? row.bankCap : DEFAULT_BANK_CAP,
		dailyStreak: typeof row.dailyStreak === 'number' ? row.dailyStreak : 0,
	};
}

export async function getOrCreateEconomy(userId: string, guildId: string) {
	const existing = await db.query.economy.findFirst({
		where: and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)),
	});
	if (existing) return normaliseEconRow(existing);
	await db.insert(schema.economy).values({ userId, guildId });
	const [row] = await db
		.select()
		.from(schema.economy)
		.where(and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)))
		.limit(1);
	return normaliseEconRow(row!);
}

// ─── Wallet operations ─────────────────────────────────────────────────────────

export async function walletAdd(userId: string, guildId: string, amount: number): Promise<void> {
	await db
		.update(schema.economy)
		.set({ balance: sql`${schema.economy.balance} + ${amount}` })
		.where(and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)));
}

/** Returns false if the wallet has insufficient funds. */
export async function walletDeduct(userId: string, guildId: string, amount: number): Promise<boolean> {
	const result = await db
		.update(schema.economy)
		.set({ balance: sql`${schema.economy.balance} - ${amount}` })
		.where(
			and(
				eq(schema.economy.userId, userId),
				eq(schema.economy.guildId, guildId),
				sql`${schema.economy.balance} >= ${amount}`,
			),
		);
	return Number((result as any)[0]?.affectedRows ?? 0) > 0;
}

/** Atomically transfer wallet funds so a failed credit can never destroy coins. */
export async function walletTransfer(
	fromUserId: string,
	toUserId: string,
	guildId: string,
	amount: number,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const deducted = await tx
			.update(schema.economy)
			.set({ balance: sql`${schema.economy.balance} - ${amount}` })
			.where(
				and(
					eq(schema.economy.userId, fromUserId),
					eq(schema.economy.guildId, guildId),
					sql`${schema.economy.balance} >= ${amount}`,
				),
			);
		if (Number((deducted as any)[0]?.affectedRows ?? 0) === 0) return false;

		const credited = await tx
			.update(schema.economy)
			.set({ balance: sql`${schema.economy.balance} + ${amount}` })
			.where(and(eq(schema.economy.userId, toUserId), eq(schema.economy.guildId, guildId)));
		if (Number((credited as any)[0]?.affectedRows ?? 0) === 0)
			throw new Error(`Economy recipient ${toUserId} does not exist`);
		return true;
	});
}

// ─── Bank operations ───────────────────────────────────────────────────────────

export async function bankDeposit(userId: string, guildId: string, requested: number | 'all') {
	for (let attempt = 0; attempt < 3; attempt++) {
		const row = await getOrCreateEconomy(userId, guildId);
		const space = row.bankCap - row.bank;
		const toDeposit = requested === 'all' ? Math.min(row.balance, space) : Math.min(requested, row.balance, space);
		if (toDeposit <= 0) return { deposited: 0, wallet: row.balance, bank: row.bank, bankCap: row.bankCap };

		const result = await db
			.update(schema.economy)
			.set({
				balance: sql`${schema.economy.balance} - ${toDeposit}`,
				bank: sql`${schema.economy.bank} + ${toDeposit}`,
			})
			.where(
				and(
					eq(schema.economy.userId, userId),
					eq(schema.economy.guildId, guildId),
					sql`${schema.economy.balance} >= ${toDeposit}`,
					sql`${schema.economy.bank} + ${toDeposit} <= ${schema.economy.bankCap}`,
				),
			);
		if (Number((result as any)[0]?.affectedRows ?? 0) > 0) {
			const [updated] = await db
				.select({
					wallet: schema.economy.balance,
					bank: schema.economy.bank,
					bankCap: schema.economy.bankCap,
				})
				.from(schema.economy)
				.where(and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)))
				.limit(1);
			if (updated) return { deposited: toDeposit, ...updated };
		}
	}
	const row = await getOrCreateEconomy(userId, guildId);
	return { deposited: 0, wallet: row.balance, bank: row.bank, bankCap: row.bankCap };
}

export async function bankWithdraw(userId: string, guildId: string, requested: number | 'all') {
	for (let attempt = 0; attempt < 3; attempt++) {
		const row = await getOrCreateEconomy(userId, guildId);
		const toWithdraw = requested === 'all' ? row.bank : Math.min(requested, row.bank);
		if (toWithdraw <= 0) return { withdrawn: 0, wallet: row.balance, bank: row.bank };

		const result = await db
			.update(schema.economy)
			.set({
				balance: sql`${schema.economy.balance} + ${toWithdraw}`,
				bank: sql`${schema.economy.bank} - ${toWithdraw}`,
			})
			.where(
				and(
					eq(schema.economy.userId, userId),
					eq(schema.economy.guildId, guildId),
					sql`${schema.economy.bank} >= ${toWithdraw}`,
				),
			);
		if (Number((result as any)[0]?.affectedRows ?? 0) > 0) {
			const [updated] = await db
				.select({ wallet: schema.economy.balance, bank: schema.economy.bank })
				.from(schema.economy)
				.where(and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)))
				.limit(1);
			if (updated) return { withdrawn: toWithdraw, ...updated };
		}
	}
	const row = await getOrCreateEconomy(userId, guildId);
	return { withdrawn: 0, wallet: row.balance, bank: row.bank };
}

// ─── Transaction log ───────────────────────────────────────────────────────────

export async function logTx(
	guildId: string,
	userId: string,
	type: TxType,
	amount: number,
	opts?: { toUserId?: string; note?: string },
): Promise<void> {
	await db
		.insert(schema.economyTransactions)
		.values({ guildId, userId, type, amount, toUserId: opts?.toUserId, note: opts?.note });
}

// ─── Active effects ────────────────────────────────────────────────────────────

export async function hasActivePadlock(userId: string, guildId: string): Promise<boolean> {
	const row = await db.query.economy.findFirst({
		where: and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)),
	});
	return !!(row?.padlockExpiresAt && row.padlockExpiresAt.getTime() > Date.now());
}

export async function hasActiveWorkBoost(userId: string, guildId: string): Promise<boolean> {
	const row = await db.query.economy.findFirst({
		where: and(eq(schema.economy.userId, userId), eq(schema.economy.guildId, guildId)),
	});
	return !!(row?.workBoostExpiresAt && row.workBoostExpiresAt.getTime() > Date.now());
}

// ─── Inventory helpers ─────────────────────────────────────────────────────────

/** Find an item the user owns by itemKey. Returns null if not owned. */
export async function getInventoryItem(userId: string, guildId: string, itemKey: string) {
	const item = await db.query.shopItems.findFirst({
		where: and(eq(schema.shopItems.guildId, guildId), eq(schema.shopItems.itemKey, itemKey)),
	});
	if (!item) return null;

	const inv = await db.query.userInventory.findFirst({
		where: and(
			eq(schema.userInventory.guildId, guildId),
			eq(schema.userInventory.userId, userId),
			eq(schema.userInventory.itemId, item.id),
		),
	});
	return inv && inv.quantity > 0 ? { item, inv } : null;
}

/** Consume one of an item from a user's inventory. */
export async function consumeItem(_userId: string, _guildId: string, invId: number, currentQty: number): Promise<void> {
	if (currentQty === 1) {
		await db.delete(schema.userInventory).where(eq(schema.userInventory.id, invId));
	} else {
		await db
			.update(schema.userInventory)
			.set({ quantity: currentQty - 1 })
			.where(eq(schema.userInventory.id, invId));
	}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function rand(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function fmtCoins(n: number): string {
	return `**${n.toLocaleString()}** ${CURRENCY}`;
}

/** Returns remaining cooldown in ms, or 0 if ready. */
export function checkCooldown(lastAt: Date | null | undefined, cooldownMs: number): number {
	if (!lastAt) return 0;
	const elapsed = Date.now() - lastAt.getTime();
	return elapsed < cooldownMs ? cooldownMs - elapsed : 0;
}

export function fmtRemaining(ms: number): string {
	const s = Math.ceil(ms / 1000);
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const parts: string[] = [];
	if (h) parts.push(`${h}h`);
	if (m) parts.push(`${m}m`);
	if (sec || !parts.length) parts.push(`${sec}s`);
	return parts.join(' ');
}

export function progressBar(current: number, max: number, _length = 10): string {
	const pct = Math.round((current / Math.max(max, 1)) * 100);
	return `${pct}%`;
}
