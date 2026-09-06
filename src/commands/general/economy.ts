import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ComponentType,
	ContainerBuilder,
	type GuildMember,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SectionBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
} from 'discord.js';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { type BjCard, buildDeck, drawBlackjackBoard, handTotal, shuffleDeck } from '../../lib/BlackjackUtil.js';
import { formatBlacklistDenial, isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import {
	Colors,
	CV2_FLAG,
	errorReply,
	makeContainer,
	meta,
	separator,
	successReply,
	warningReply,
} from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	BEG_MAX,
	BEG_MIN,
	bankDeposit,
	bankWithdraw,
	CRIME_COOLDOWN_MS,
	CRIME_FAIL_MAX,
	CRIME_FAIL_MIN,
	CRIME_SUCCESS_MAX,
	CRIME_SUCCESS_MIN,
	CRIME_SUCCESS_RATE,
	CURRENCY,
	checkCooldown,
	consumeItem,
	DAILY_COOLDOWN_MS,
	DAILY_MAX,
	DAILY_MIN,
	DIG_TIERS,
	ensureShopSeeded,
	FISH_COOLDOWN_MS,
	FISH_TIERS,
	fmtCoins,
	fmtRemaining,
	getInventoryItem,
	getOrCreateEconomy,
	HUNT_TIERS,
	hasActivePadlock,
	hasActiveWorkBoost,
	logTx,
	MAX_STREAK,
	MINE_COOLDOWN_MS,
	MINE_TIERS,
	MONTHLY_MAX,
	MONTHLY_MIN,
	pickTier,
	ROB_COOLDOWN_MS,
	ROB_FINE_PERCENT,
	ROB_MIN_ROBBER_WALLET,
	ROB_MIN_TARGET_WALLET,
	ROB_STEAL_MAX,
	ROB_STEAL_MIN,
	ROB_SUCCESS_RATE,
	rand,
	SCAVENGE_COOLDOWN_MS,
	STREAK_GRACE_MS,
	WEEKLY_MAX,
	WEEKLY_MIN,
	WORK_COOLDOWN_MS,
	WORK_MAX,
	WORK_MIN,
	walletAdd,
	walletDeduct,
	walletTransfer,
} from '../../lib/EconomyUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// ─── Slots ─────────────────────────────────────────────────────────────────────

const SLOT_POOL = [
	'🍒',
	'🍒',
	'🍒',
	'🍒',
	'🍒',
	'🍋',
	'🍋',
	'🍋',
	'🍋',
	'🍊',
	'🍊',
	'🍊',
	'🍊',
	'🍇',
	'🍇',
	'🍇',
	'🔔',
	'🔔',
	'🔔',
	'💎',
	'💎',
	'🎰',
];
const SLOT_PAYOUT: Record<string, number> = { '🎰': 20, '💎': 8, '🔔': 4, '🍇': 3, '🍊': 2.5, '🍋': 2, '🍒': 1.5 };

// ─── Flavour text ──────────────────────────────────────────────────────────────

const WORK_JOBS = [
	{ job: 'moderated a Discord server all night', emoji: '🛡️' },
	{ job: 'streamed on Twitch for 4 hours', emoji: '🎮' },
	{ job: 'delivered pizzas across town', emoji: '🍕' },
	{ job: 'drove for Uber', emoji: '🚗' },
	{ job: 'walked some dogs', emoji: '🐕' },
	{ job: 'did some freelance coding', emoji: '💻' },
	{ job: 'taught piano lessons', emoji: '🎹' },
	{ job: 'sold merch at a concert', emoji: '🎤' },
	{ job: 'mined Minecraft diamonds all day', emoji: '⛏️' },
	{ job: 'completed a bug bounty report', emoji: '🐛' },
	{ job: 'flipped burgers at a diner', emoji: '🍔' },
	{ job: 'shot a sponsored YouTube video', emoji: '📹' },
	{ job: 'won a local chess tournament', emoji: '♟️' },
	{ job: 'built a Redstone contraption for a client', emoji: '🔴' },
	{ job: 'ran the AloraMC store for the day', emoji: '🏪' },
];

const CRIME_SUCCESS_MSGS = [
	'You pickpocketed a distracted tourist.',
	'You hacked a company database and found loose coins.',
	'You sold counterfeit concert tickets outside the venue.',
	'You robbed a vending machine — classic.',
	'You forged a receipt and got a full refund.',
	'You ran a short-lived pyramid scheme. Profitable!',
	'You stole a shopping cart full of groceries. No regrets.',
	'You scammed someone on an item flip. Easy money.',
	'You found an unattended wallet. Finders keepers.',
];

const CRIME_FAIL_MSGS = [
	'You got caught shoplifting. Paid a fine.',
	'Your con went sideways and cost you.',
	'You were caught hacking — fined heavily.',
	'The vending machine fought back. You lost.',
	'Caught on camera. Lawyer fees hurt.',
	"Security spotted you. Couldn't run fast enough.",
];

const FISH_MISS_MSGS = [
	'You cast your line and waited... nothing.',
	'Something tugged, then got away.',
	'You pulled up an old boot. Tragic.',
	'The fish laughed at your bait.',
];

const MINE_MISS_MSGS = [
	'You dug for an hour and found nothing but dirt.',
	'Your pickaxe hit bedrock. No luck.',
	'Just gravel. Completely useless gravel.',
	'You broke your torch mid-dig. Found nothing.',
];

// ─── Guard ────────────────────────────────────────────────────────────────────

async function ecoGuard(interaction: Subcommand.ChatInputCommandInteraction): Promise<boolean> {
	if (!interaction.inCachedGuild()) {
		await interaction.editReply(errorReply('Server only.'));
		return false;
	}
	if (!(await isModuleEnabled(interaction.guildId, 'economy'))) {
		await interaction.editReply(errorReply('Economy module is disabled.'));
		return false;
	}
	return true;
}

// ─── Pending duels ────────────────────────────────────────────────────────────

interface PendingDuel {
	challengerId: string;
	targetId: string;
	amount: number;
	guildId: string;
	timer: ReturnType<typeof setTimeout>;
}
const pendingDuels = new Map<string, PendingDuel>();

// ─── Command ──────────────────────────────────────────────────────────────────

@ApplyOptions<Subcommand.Options>({
	name: 'economy',
	description: 'Wallet, claims, earning, and the shop. Casino is /gamble.',
	subcommands: [
		{ name: 'help', chatInputRun: 'runHelp' },
		{ name: 'balance', chatInputRun: 'runBalance' },
		{ name: 'daily', chatInputRun: 'runDaily' },
		{ name: 'weekly', chatInputRun: 'runWeekly' },
		{ name: 'monthly', chatInputRun: 'runMonthly' },
		{ name: 'deposit', chatInputRun: 'runDeposit' },
		{ name: 'withdraw', chatInputRun: 'runWithdraw' },
		{ name: 'pay', chatInputRun: 'runPay' },
		{ name: 'inventory', chatInputRun: 'runInventory' },
		{ name: 'use', chatInputRun: 'runUse' },
		{ name: 'leaderboard', chatInputRun: 'runLeaderboard' },
		{ name: 'transactions', chatInputRun: 'runTransactions' },
		{
			name: 'earn',
			type: 'group',
			entries: [
				{ name: 'work', chatInputRun: 'runWork' },
				{ name: 'crime', chatInputRun: 'runCrime' },
				{ name: 'rob', chatInputRun: 'runRob' },
				{ name: 'fish', chatInputRun: 'runFish' },
				{ name: 'mine', chatInputRun: 'runMine' },
				{ name: 'scavenge', chatInputRun: 'runScavenge' },
			],
		},
		{
			name: 'shop',
			type: 'group',
			entries: [
				{ name: 'list', chatInputRun: 'runShopList' },
				{ name: 'buy', chatInputRun: 'runShopBuy' },
			],
		},
		{
			name: 'admin',
			type: 'group',
			entries: [
				{ name: 'give', chatInputRun: 'runAdminGive' },
				{ name: 'take', chatInputRun: 'runAdminTake' },
				{ name: 'reset', chatInputRun: 'runAdminReset' },
			],
		},
	],
})
export class EconomyCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('economy')
				.setDescription('Wallet, claims, earning, and the shop. Casino is /gamble.')
				.addSubcommand((s) => s.setName('help').setDescription('Quick map of economy commands.'))
				.addSubcommand((s) =>
					s
						.setName('balance')
						.setDescription("Check your (or another user's) wallet and bank.")
						.addUserOption((o) => o.setName('user').setDescription('User to check.').setRequired(false)),
				)
				.addSubcommand((s) => s.setName('daily').setDescription(`Collect your daily ${CURRENCY} reward.`))
				.addSubcommand((s) => s.setName('weekly').setDescription(`Collect your weekly ${CURRENCY} bonus.`))
				.addSubcommand((s) => s.setName('monthly').setDescription(`Collect your monthly ${CURRENCY} jackpot.`))
				.addSubcommand((s) =>
					s
						.setName('deposit')
						.setDescription('Deposit coins from wallet into bank.')
						.addStringOption((o) => o.setName('amount').setDescription('Amount or "all".').setRequired(true)),
				)
				.addSubcommand((s) =>
					s
						.setName('withdraw')
						.setDescription('Withdraw coins from bank to wallet.')
						.addStringOption((o) => o.setName('amount').setDescription('Amount or "all".').setRequired(true)),
				)
				.addSubcommand((s) =>
					s
						.setName('pay')
						.setDescription('Send coins to another user.')
						.addUserOption((o) => o.setName('user').setDescription('Recipient.').setRequired(true))
						.addIntegerOption((o) => o.setName('amount').setDescription('Amount.').setRequired(true).setMinValue(1)),
				)
				.addSubcommand((s) =>
					s
						.setName('inventory')
						.setDescription('View your item inventory.')
						.addUserOption((o) => o.setName('user').setDescription('User to check.').setRequired(false)),
				)
				.addSubcommand((s) =>
					s
						.setName('use')
						.setDescription('Use a consumable item.')
						.addStringOption((o) => o.setName('item').setDescription('Item name.').setRequired(true).setMaxLength(100)),
				)
				.addSubcommand((s) => s.setName('leaderboard').setDescription('Top coin holders.'))
				.addSubcommand((s) =>
					s
						.setName('transactions')
						.setDescription('Recent transaction history.')
						.addUserOption((o) => o.setName('user').setDescription('User to view.').setRequired(false)),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('earn')
						.setDescription('Make coins — jobs, crime, fishing, and more.')
						.addSubcommand((s) =>
							s.setName('work').setDescription(`Work for coins. ${WORK_COOLDOWN_MS / 3_600_000}h cooldown.`),
						)
						.addSubcommand((s) =>
							s.setName('crime').setDescription(`Attempt a crime — risky. ${CRIME_COOLDOWN_MS / 3_600_000}h cooldown.`),
						)
						.addSubcommand((s) =>
							s
								.setName('rob')
								.setDescription("Steal from another user's wallet.")
								.addUserOption((o) => o.setName('user').setDescription('Target.').setRequired(true)),
						)
						.addSubcommand((s) => s.setName('fish').setDescription('Cast your line. 30 min cooldown.'))
						.addSubcommand((s) => s.setName('mine').setDescription('Mine for ore. 45 min cooldown.'))
						.addSubcommand((s) =>
							s
								.setName('scavenge')
								.setDescription('Beg, hunt, or dig for loose coins.')
								.addStringOption((o) =>
									o
										.setName('activity')
										.setDescription('What to do.')
										.setRequired(true)
										.addChoices(
											{ name: 'Beg', value: 'beg' },
											{ name: 'Hunt', value: 'hunt' },
											{ name: 'Dig', value: 'dig' },
										),
								),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('shop')
						.setDescription('Browse and purchase items.')
						.addSubcommand((s) => s.setName('list').setDescription('Browse shop items.'))
						.addSubcommand((s) =>
							s
								.setName('buy')
								.setDescription('Purchase an item.')
								.addStringOption((o) =>
									o.setName('item').setDescription('Item name.').setRequired(true).setMaxLength(100),
								),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('admin')
						.setDescription('Manage server economy balances (Staff only).')
						.addSubcommand((s) =>
							s
								.setName('give')
								.setDescription('Give coins to a user.')
								.addUserOption((o) => o.setName('user').setDescription('The user to give coins to.').setRequired(true))
								.addIntegerOption((o) =>
									o.setName('amount').setDescription('Amount of coins.').setRequired(true).setMinValue(1),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('take')
								.setDescription('Take coins from a user.')
								.addUserOption((o) =>
									o.setName('user').setDescription('The user to take coins from.').setRequired(true),
								)
								.addIntegerOption((o) =>
									o.setName('amount').setDescription('Amount of coins.').setRequired(true).setMinValue(1),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('reset')
								.setDescription("Reset a user's wallet, bank, and streak.")
								.addUserOption((o) => o.setName('user').setDescription('The user to reset.').setRequired(true)),
						),
				),
		);
	}

	// ── help ───────────────────────────────────────────────────────────────────

	public async runHelp(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const c = makeContainer({ color: Colors.Info, header: 'Economy map' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					'**Wallet** — `/economy balance` `deposit` `withdraw` `pay`',
					'**Claims** — `/economy daily` `weekly` `monthly`',
					'**Earn** — `/economy earn work|crime|rob|fish|mine|scavenge`',
					'**Items** — `/economy inventory` `use` · `/economy shop list|buy`',
					'**Stats** — `/economy leaderboard` `transactions`',
					'**Casino** — `/gamble` (slots, cards, crash, lottery, …)',
					`-# Staff: \`/economy admin give|take|reset\``,
				].join('\n'),
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── balance ────────────────────────────────────────────────────────────────

	public async runBalance(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const target = interaction.options.getUser('user') ?? interaction.user;
		const row = await getOrCreateEconomy(target.id, interaction.guild!.id);
		const total = row.balance + row.bank;
		const pct = Math.round((row.bank / Math.max(row.bankCap, 1)) * 100);
		const avatarUrl = target.displayAvatarURL({ size: 64, extension: 'png' });
		const now = Date.now();

		// Active effects
		const effects: string[] = [];
		const padlockActive = row.padlockExpiresAt && row.padlockExpiresAt.getTime() > now;
		const workBoosted = row.workBoostExpiresAt && row.workBoostExpiresAt.getTime() > now;
		if (padlockActive) effects.push(`🔒 Padlock expires <t:${Math.floor(row.padlockExpiresAt!.getTime() / 1000)}:R>`);
		if (workBoosted)
			effects.push(`⚡ Work Boost expires <t:${Math.floor(row.workBoostExpiresAt!.getTime() / 1000)}:R>`);

		// Cooldown status
		const dailyReady = checkCooldown(row.lastDailyAt, DAILY_COOLDOWN_MS) === 0;
		const workReady = checkCooldown(row.lastWorkAt, WORK_COOLDOWN_MS) === 0;
		const crimeReady = checkCooldown(row.lastCrimeAt, CRIME_COOLDOWN_MS) === 0;
		const fishReady = checkCooldown(row.lastFishAt, FISH_COOLDOWN_MS) === 0;
		const mineReady = checkCooldown(row.lastMineAt, MINE_COOLDOWN_MS) === 0;
		const readyList = [
			dailyReady && 'Daily',
			workReady && 'Earn · Work',
			crimeReady && 'Earn · Crime',
			fishReady && 'Earn · Fish',
			mineReady && 'Earn · Mine',
		].filter(Boolean) as string[];

		const content = [
			`### ${target.displayName}'s Finances`,
			`**Wallet** ${row.balance.toLocaleString()} ${CURRENCY}`,
			`**Bank** ${row.bank.toLocaleString()} ${CURRENCY} · ${pct}% of ${row.bankCap.toLocaleString()}`,
			meta(`Net worth ${total.toLocaleString()} ${CURRENCY}`, `Streak ${row.dailyStreak}/${MAX_STREAK}`),
		].join('\n');

		const container = new ContainerBuilder().setAccentColor(Colors.Info);
		const section = new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
			.setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
		container.addSectionComponents(section);

		if (effects.length || readyList.length) {
			container.addSeparatorComponents(separator());
			const lines: string[] = [];
			if (effects.length) lines.push(effects.join('\n'));
			if (readyList.length) lines.push(`✅ **Ready:** ${readyList.join(' · ')}`);
			container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		}

		if (target.id === interaction.user.id) {
			const actionRow1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId('eco:dash:deposit')
					.setLabel('Deposit All')
					.setStyle(ButtonStyle.Secondary)
					.setEmoji('🏦'),
				new ButtonBuilder()
					.setCustomId('eco:dash:withdraw')
					.setLabel('Withdraw All')
					.setStyle(ButtonStyle.Secondary)
					.setEmoji('👜'),
				new ButtonBuilder()
					.setCustomId('eco:dash:daily')
					.setLabel('Daily')
					.setStyle(dailyReady ? ButtonStyle.Success : ButtonStyle.Secondary)
					.setDisabled(!dailyReady),
			);
			const actionRow2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder()
					.setCustomId('eco:dash:work')
					.setLabel('Work')
					.setStyle(workReady ? ButtonStyle.Primary : ButtonStyle.Secondary)
					.setDisabled(!workReady),
				new ButtonBuilder()
					.setCustomId('eco:dash:crime')
					.setLabel('Crime')
					.setStyle(crimeReady ? ButtonStyle.Danger : ButtonStyle.Secondary)
					.setDisabled(!crimeReady),
				new ButtonBuilder()
					.setCustomId('eco:dash:slots')
					.setLabel('Slots (100)')
					.setStyle(ButtonStyle.Secondary)
					.setEmoji('🎰'),
			);
			container.addActionRowComponents(actionRow1);
			container.addActionRowComponents(actionRow2);
		}

		return interaction.editReply({ components: [container], flags: CV2_FLAG as any });
	}

	// ── daily ──────────────────────────────────────────────────────────────────

	public async runDaily(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(row.lastDailyAt, DAILY_COOLDOWN_MS);
		if (remaining > 0) {
			const next = Math.floor((Date.now() + remaining) / 1000);
			return interaction.editReply(warningReply(`Already collected today. Come back <t:${next}:R>.`));
		}

		// Streak logic — check for Streak Freeze if streak would break
		const withinGrace = row.lastDailyAt && Date.now() - row.lastDailyAt.getTime() < STREAK_GRACE_MS;
		let newStreak = Math.min((withinGrace ? row.dailyStreak : 0) + 1, MAX_STREAK);
		let usedStreakFreeze = false;

		if (!withinGrace && row.dailyStreak > 0 && row.lastDailyAt) {
			// Streak would break — check for Streak Freeze
			const freeze = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'streak_freeze');
			if (freeze) {
				await consumeItem(interaction.user.id, interaction.guild!.id, freeze.inv.id, freeze.inv.quantity);
				newStreak = Math.min(row.dailyStreak + 1, MAX_STREAK);
				usedStreakFreeze = true;
			}
		}

		// Lucky Charm — +50% if owned
		const charm = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'lucky_charm');
		const streakBonus = 1 + (newStreak - 1) * 0.1;
		const charmBonus = charm ? 1.5 : 1.0;
		const base = rand(DAILY_MIN, DAILY_MAX);
		const amount = Math.floor(base * streakBonus * charmBonus);
		if (charm) await consumeItem(interaction.user.id, interaction.guild!.id, charm.inv.id, charm.inv.quantity);

		await db
			.update(schema.economy)
			.set({ balance: sql`${schema.economy.balance} + ${amount}`, lastDailyAt: new Date(), dailyStreak: newStreak })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));

		await logTx(interaction.guild!.id, interaction.user.id, 'daily', amount, { note: `Streak ×${newStreak}` });

		const extras: string[] = [];
		if (newStreak > 1) extras.push(`🔥 **${newStreak}-day streak** (+${Math.round((streakBonus - 1) * 100)}% bonus)`);
		if (newStreak >= MAX_STREAK) extras.push('👑 Max streak — keep it going!');
		if (charm) extras.push('🍀 Lucky Charm applied (+50%)');
		if (usedStreakFreeze) extras.push('🧊 Streak Freeze saved your streak!');

		const lines = [
			`Collected ${fmtCoins(amount)} — added to your wallet.`,
			...extras,
			`-# New wallet: ${(row.balance + amount).toLocaleString()} ${CURRENCY}`,
		];
		return interaction.editReply(successReply(lines.join('\n')));
	}

	// ── weekly ─────────────────────────────────────────────────────────────────

	public async runWeekly(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
		const [recent] = await db
			.select()
			.from(schema.economyTransactions)
			.where(
				and(
					eq(schema.economyTransactions.guildId, interaction.guild!.id),
					eq(schema.economyTransactions.userId, interaction.user.id),
					eq(schema.economyTransactions.type, 'weekly'),
					gte(schema.economyTransactions.createdAt, weekAgo),
				),
			)
			.limit(1);
		if (recent) {
			const next = Math.floor((recent.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000) / 1000);
			return interaction.editReply(warningReply(`Weekly already claimed. Next <t:${next}:R>.`));
		}

		const amount = rand(WEEKLY_MIN, WEEKLY_MAX);
		await db
			.update(schema.economy)
			.set({ balance: sql`${schema.economy.balance} + ${amount}` })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
		await logTx(interaction.guild!.id, interaction.user.id, 'weekly', amount, { note: 'Weekly bonus' });
		return interaction.editReply(successReply(`Weekly bonus: ${fmtCoins(amount)} added to your wallet.`));
	}

	// ── monthly ────────────────────────────────────────────────────────────────

	public async runMonthly(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
		const [recent] = await db
			.select()
			.from(schema.economyTransactions)
			.where(
				and(
					eq(schema.economyTransactions.guildId, interaction.guild!.id),
					eq(schema.economyTransactions.userId, interaction.user.id),
					eq(schema.economyTransactions.type, 'monthly'),
					gte(schema.economyTransactions.createdAt, monthAgo),
				),
			)
			.limit(1);
		if (recent) {
			const next = Math.floor((recent.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000) / 1000);
			return interaction.editReply(warningReply(`Monthly already claimed. Next <t:${next}:R>.`));
		}

		const amount = rand(MONTHLY_MIN, MONTHLY_MAX);
		await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		await walletAdd(interaction.user.id, interaction.guild!.id, amount);
		await logTx(interaction.guild!.id, interaction.user.id, 'monthly', amount, { note: 'Monthly jackpot' });
		return interaction.editReply(successReply(`🗓️ Monthly jackpot: ${fmtCoins(amount)} dumped into your wallet.`));
	}

	// ── deposit ────────────────────────────────────────────────────────────────

	public async runDeposit(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const raw = interaction.options.getString('amount', true).trim().toLowerCase();
		const requested: number | 'all' = raw === 'all' ? 'all' : Number(raw);
		if (requested !== 'all' && (!Number.isInteger(requested) || (requested as number) <= 0)) {
			return interaction.editReply(errorReply('Enter a positive integer or "all".'));
		}

		const result = await bankDeposit(interaction.user.id, interaction.guild!.id, requested);
		if (result.deposited === 0)
			return interaction.editReply(warningReply('Nothing to deposit — wallet empty or bank full.'));

		return interaction.editReply(
			successReply(
				`Deposited ${fmtCoins(result.deposited)} into bank.\n-# Wallet: ${result.wallet.toLocaleString()} ${CURRENCY}  ·  Bank: ${result.bank.toLocaleString()} / ${result.bankCap.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── withdraw ───────────────────────────────────────────────────────────────

	public async runWithdraw(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const raw = interaction.options.getString('amount', true).trim().toLowerCase();
		const requested: number | 'all' = raw === 'all' ? 'all' : Number(raw);
		if (requested !== 'all' && (!Number.isInteger(requested) || (requested as number) <= 0)) {
			return interaction.editReply(errorReply('Enter a positive integer or "all".'));
		}

		const result = await bankWithdraw(interaction.user.id, interaction.guild!.id, requested);
		if (result.withdrawn === 0) return interaction.editReply(warningReply('Bank is empty.'));

		return interaction.editReply(
			successReply(
				`Withdrew ${fmtCoins(result.withdrawn)} to wallet.\n-# Wallet: ${result.wallet.toLocaleString()} ${CURRENCY}  ·  Bank: ${result.bank.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── pay ────────────────────────────────────────────────────────────────────

	public async runPay(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		if (target.id === interaction.user.id) return interaction.editReply(errorReply('Cannot pay yourself.'));
		if (target.bot) return interaction.editReply(errorReply('Cannot pay a bot.'));

		await getOrCreateEconomy(target.id, interaction.guild!.id);
		const ok = await walletTransfer(interaction.user.id, target.id, interaction.guild!.id, amount);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(amount)} but only have ${fmtCoins(row.balance)}.`));
		}
		await logTx(interaction.guild!.id, interaction.user.id, 'pay_sent', amount, { toUserId: target.id });
		await logTx(interaction.guild!.id, target.id, 'pay_received', amount, { toUserId: interaction.user.id });
		return interaction.editReply(successReply(`Sent ${fmtCoins(amount)} to <@${target.id}>.`));
	}

	// ── work ───────────────────────────────────────────────────────────────────

	public async runWork(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(row.lastWorkAt, WORK_COOLDOWN_MS);
		if (remaining > 0)
			return interaction.editReply(
				warningReply(`Already worked recently. Try again in **${fmtRemaining(remaining)}**.`),
			);

		const boosted = await hasActiveWorkBoost(interaction.user.id, interaction.guild!.id);
		const multiplier = boosted ? 2 : 1;
		const earned = rand(WORK_MIN * multiplier, WORK_MAX * multiplier);
		const job = WORK_JOBS[rand(0, WORK_JOBS.length - 1)];

		await db
			.update(schema.economy)
			.set({ balance: sql`${schema.economy.balance} + ${earned}`, lastWorkAt: new Date() })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
		await logTx(interaction.guild!.id, interaction.user.id, 'work', earned, { note: job.job });

		const lines = [
			`${job.emoji} You ${job.job} and earned ${fmtCoins(earned)}!`,
			boosted ? `⚡ Work Boost active — double earnings!` : '',
			`-# Wallet: ${(row.balance + earned).toLocaleString()} ${CURRENCY}`,
		].filter(Boolean);
		return interaction.editReply(successReply(lines.join('\n')));
	}

	// ── crime ──────────────────────────────────────────────────────────────────

	public async runCrime(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(row.lastCrimeAt, CRIME_COOLDOWN_MS);
		if (remaining > 0)
			return interaction.editReply(warningReply(`Still lying low. Try again in **${fmtRemaining(remaining)}**.`));

		// Heist Kit — boosts success rate to 75%
		const kit = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'heist_kit');
		const spree = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'crime_spree');
		let successRate = kit ? 0.75 : CRIME_SUCCESS_RATE;
		if (spree) successRate = Math.min(0.9, successRate + 0.2);
		if (kit) await consumeItem(interaction.user.id, interaction.guild!.id, kit.inv.id, kit.inv.quantity);
		if (spree) await consumeItem(interaction.user.id, interaction.guild!.id, spree.inv.id, spree.inv.quantity);

		await db
			.update(schema.economy)
			.set({ lastCrimeAt: new Date() })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));

		if (Math.random() < successRate) {
			const earned = rand(CRIME_SUCCESS_MIN, CRIME_SUCCESS_MAX);
			await walletAdd(interaction.user.id, interaction.guild!.id, earned);
			await logTx(interaction.guild!.id, interaction.user.id, 'crime', earned);
			const msg = CRIME_SUCCESS_MSGS[rand(0, CRIME_SUCCESS_MSGS.length - 1)];
			const lines = [
				msg,
				`Got away with ${fmtCoins(earned)}!`,
				kit ? `-# 🧰 Heist Kit used (75% success rate)` : '',
				`-# Wallet: ${(row.balance + earned).toLocaleString()} ${CURRENCY}`,
			].filter(Boolean);
			return interaction.editReply(successReply(lines.join('\n')));
		}

		const fine = rand(CRIME_FAIL_MIN, CRIME_FAIL_MAX);
		const actualFine = Math.min(fine, row.balance);
		if (actualFine > 0) await walletDeduct(interaction.user.id, interaction.guild!.id, actualFine);
		await logTx(interaction.guild!.id, interaction.user.id, 'crime', actualFine, { note: 'Failed — fined' });
		const msg = CRIME_FAIL_MSGS[rand(0, CRIME_FAIL_MSGS.length - 1)];
		return interaction.editReply(
			errorReply(
				`${msg}\nFined ${fmtCoins(actualFine)}.\n-# Wallet: ${(row.balance - actualFine).toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── rob ────────────────────────────────────────────────────────────────────

	public async runRob(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		if (target.id === interaction.user.id) return interaction.editReply(errorReply('Cannot rob yourself.'));
		if (target.bot) return interaction.editReply(errorReply('Cannot rob a bot.'));

		const robberRow = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(robberRow.lastRobAt, ROB_COOLDOWN_MS);
		if (remaining > 0)
			return interaction.editReply(warningReply(`Cooldown. Try again in **${fmtRemaining(remaining)}**.`));
		if (robberRow.balance < ROB_MIN_ROBBER_WALLET)
			return interaction.editReply(errorReply(`Need at least ${fmtCoins(ROB_MIN_ROBBER_WALLET)} to attempt a rob.`));

		const targetRow = await getOrCreateEconomy(target.id, interaction.guild!.id);
		if (targetRow.balance < ROB_MIN_TARGET_WALLET)
			return interaction.editReply(errorReply(`<@${target.id}> doesn't have enough to rob.`));

		await db
			.update(schema.economy)
			.set({ lastRobAt: new Date() })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));

		if (await hasActivePadlock(target.id, interaction.guild!.id)) {
			return interaction.editReply(errorReply(`🔒 <@${target.id}> has an active padlock — blocked!`));
		}

		const stealAttempt = Math.floor(
			targetRow.balance * (ROB_STEAL_MIN + Math.random() * (ROB_STEAL_MAX - ROB_STEAL_MIN)),
		);

		if (Math.random() < ROB_SUCCESS_RATE) {
			const shield = await getInventoryItem(target.id, interaction.guild!.id, 'robbery_shield');
			if (shield) {
				await consumeItem(target.id, interaction.guild!.id, shield.inv.id, shield.inv.quantity);
				return interaction.editReply(
					errorReply(`🛡️ <@${target.id}>'s Robbery Shield blocked you! The shield was consumed.`),
				);
			}
			const stolen = Math.min(stealAttempt, targetRow.balance);
			await walletDeduct(target.id, interaction.guild!.id, stolen);
			await walletAdd(interaction.user.id, interaction.guild!.id, stolen);
			await logTx(interaction.guild!.id, interaction.user.id, 'rob_taken', stolen, { toUserId: target.id });
			await logTx(interaction.guild!.id, target.id, 'rob_lost', stolen, { toUserId: interaction.user.id });
			return interaction.editReply(
				successReply(
					`You stole ${fmtCoins(stolen)} from <@${target.id}>.\n-# Wallet: ${(robberRow.balance + stolen).toLocaleString()} ${CURRENCY}`,
				),
			);
		}

		const fine = Math.floor(stealAttempt * ROB_FINE_PERCENT);
		const actualFine = Math.min(fine, robberRow.balance);
		if (actualFine > 0) await walletDeduct(interaction.user.id, interaction.guild!.id, actualFine);
		await logTx(interaction.guild!.id, interaction.user.id, 'rob_lost', actualFine, {
			note: `Failed rob vs ${target.username}`,
		});
		return interaction.editReply(
			errorReply(
				`Caught trying to rob <@${target.id}>! Fined ${fmtCoins(actualFine)}.\n-# Wallet: ${(robberRow.balance - actualFine).toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── fish ───────────────────────────────────────────────────────────────────

	public async runFish(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(row.lastFishAt, FISH_COOLDOWN_MS);
		if (remaining > 0)
			return interaction.editReply(
				warningReply(`Still waiting for more fish to bite. Try again in **${fmtRemaining(remaining)}**.`),
			);

		await db
			.update(schema.economy)
			.set({ lastFishAt: new Date() })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));

		const hook = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'golden_hook');
		let tier = pickTier(FISH_TIERS);
		if (hook) {
			const rares = FISH_TIERS.filter((t) => t.rare);
			tier = rares[rand(0, rares.length - 1)]!;
			await consumeItem(interaction.user.id, interaction.guild!.id, hook.inv.id, hook.inv.quantity);
		}
		const earned = tier.min === 0 ? 0 : rand(tier.min, tier.max);

		if (earned > 0) {
			await walletAdd(interaction.user.id, interaction.guild!.id, earned);
			await logTx(interaction.guild!.id, interaction.user.id, 'fish', earned, { note: tier.name });
		}

		const c = makeContainer({
			color: earned > 0 ? (tier.rare ? Colors.Voice : Colors.Success) : Colors.Neutral,
			header: 'Fishing',
		});
		c.addSeparatorComponents(separator());

		if (earned === 0) {
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(FISH_MISS_MSGS[rand(0, FISH_MISS_MSGS.length - 1)]),
			);
		} else {
			const lines = [
				`${tier.emoji} **${tier.name}** caught!`,
				`+${fmtCoins(earned)}`,
				tier.rare ? `\n**Rare catch!**` : '',
				hook ? '🪝 Golden Hook guaranteed a rare catch!' : '',
				`-# Wallet: ${(row.balance + earned).toLocaleString()} ${CURRENCY}`,
			].filter(Boolean);
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		}

		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(meta(`Next cast in ${fmtRemaining(FISH_COOLDOWN_MS)}`)),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── mine ───────────────────────────────────────────────────────────────────

	public async runMine(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const remaining = checkCooldown(row.lastMineAt, MINE_COOLDOWN_MS);
		if (remaining > 0)
			return interaction.editReply(
				warningReply(`Your pickaxe needs to cool down. Try again in **${fmtRemaining(remaining)}**.`),
			);

		await db
			.update(schema.economy)
			.set({ lastMineAt: new Date() })
			.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));

		const pick = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'diamond_pick');
		let tier = pickTier(MINE_TIERS);
		if (pick) {
			const rares = MINE_TIERS.filter((t) => t.rare);
			tier = rares[rand(0, rares.length - 1)]!;
			await consumeItem(interaction.user.id, interaction.guild!.id, pick.inv.id, pick.inv.quantity);
		}
		const earned = tier.min === 0 ? 0 : rand(tier.min, tier.max);

		if (earned > 0) {
			await walletAdd(interaction.user.id, interaction.guild!.id, earned);
			await logTx(interaction.guild!.id, interaction.user.id, 'mine', earned, { note: tier.name });
		}

		const c = makeContainer({
			color: earned > 0 ? (tier.rare ? Colors.Voice : Colors.Success) : Colors.Neutral,
			header: 'Mining',
		});
		c.addSeparatorComponents(separator());

		if (earned === 0) {
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(MINE_MISS_MSGS[rand(0, MINE_MISS_MSGS.length - 1)]),
			);
		} else {
			const lines = [
				`${tier.emoji} **${tier.name}** found!`,
				`+${fmtCoins(earned)}`,
				tier.rare ? `\n**Rare ore!**` : '',
				pick ? '⛏️ Diamond Pick guaranteed rare ore!' : '',
				`-# Wallet: ${(row.balance + earned).toLocaleString()} ${CURRENCY}`,
			].filter(Boolean);
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		}

		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(meta(`Next dig in ${fmtRemaining(MINE_COOLDOWN_MS)}`)),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── scavenge ───────────────────────────────────────────────────────────────

	public async runScavenge(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const activity = interaction.options.getString('activity', true) as 'beg' | 'hunt' | 'dig';
		const since = new Date(Date.now() - SCAVENGE_COOLDOWN_MS);
		const [recent] = await db
			.select()
			.from(schema.economyTransactions)
			.where(
				and(
					eq(schema.economyTransactions.guildId, interaction.guild!.id),
					eq(schema.economyTransactions.userId, interaction.user.id),
					eq(schema.economyTransactions.type, 'scavenge'),
					gte(schema.economyTransactions.createdAt, since),
				),
			)
			.limit(1);
		if (recent) {
			const next = Math.floor((recent.createdAt.getTime() + SCAVENGE_COOLDOWN_MS) / 1000);
			return interaction.editReply(warningReply(`Still scavenging. Try again <t:${next}:R>.`));
		}

		await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		let amount = 0;
		let note: string = activity;
		let body = '';

		if (activity === 'beg') {
			amount = rand(BEG_MIN, BEG_MAX);
			const bowl = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'beg_bowl');
			if (bowl) {
				amount *= 2;
				await consumeItem(interaction.user.id, interaction.guild!.id, bowl.inv.id, bowl.inv.quantity);
				note = 'beg (bowl)';
			}
			const lines = [
				'A kind stranger tossed you some coins.',
				'You rattled a cup until someone paid you to stop.',
				'Busking paid off — barely.',
				'Someone mistook you for a streamer and tipped.',
			];
			body = `${lines[rand(0, lines.length - 1)]}\n+${fmtCoins(amount)}${bowl ? '\n🥣 Beg Bowl doubled it!' : ''}`;
		} else if (activity === 'hunt') {
			const tier = pickTier(HUNT_TIERS);
			amount = tier.min === 0 ? 0 : rand(tier.min, tier.max);
			note = `hunt:${tier.name}`;
			body =
				amount === 0
					? 'The woods were empty. Just twigs and regret.'
					: `${tier.emoji} Bagged a **${tier.name}** for ${fmtCoins(amount)}!${tier.rare ? '\n**Trophy hunt!**' : ''}`;
		} else {
			const tier = pickTier(DIG_TIERS);
			amount = tier.min === 0 ? rand(tier.min, Math.max(tier.max, 0)) : rand(tier.min, tier.max);
			note = `dig:${tier.name}`;
			body =
				amount <= 10
					? `${tier.emoji} **${tier.name}** — basically nothing.`
					: `${tier.emoji} Unearthed **${tier.name}** worth ${fmtCoins(amount)}!${tier.rare ? '\n**Buried treasure!**' : ''}`;
		}

		if (amount > 0) await walletAdd(interaction.user.id, interaction.guild!.id, amount);
		await logTx(interaction.guild!.id, interaction.user.id, 'scavenge', amount, { note });

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const c = makeContainer({
			color: amount > 50 ? Colors.Success : Colors.Neutral,
			header: `Scavenge · ${activity}`,
		});
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`${body}\n-# Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── duel ───────────────────────────────────────────────────────────────────

	public async runDuel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);

		if (target.id === interaction.user.id) return interaction.editReply(errorReply('Cannot duel yourself.'));
		if (target.bot) return interaction.editReply(errorReply('Cannot duel a bot.'));
		if (pendingDuels.has(interaction.user.id))
			return interaction.editReply(warningReply('You already have a pending duel.'));

		const challengerRow = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		if (challengerRow.balance < amount)
			return interaction.editReply(
				errorReply(`Need ${fmtCoins(amount)} to start this duel. You have ${fmtCoins(challengerRow.balance)}.`),
			);

		const acceptId = `eco:duel:accept:${interaction.user.id}`;
		const declineId = `eco:duel:decline:${interaction.user.id}`;

		const c = makeContainer({ color: 0xf39c12, header: 'Duel Challenge' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`<@${interaction.user.id}> challenges <@${target.id}> to a duel!\n\n**Bet:** ${fmtCoins(amount)} each — winner takes **${fmtCoins(amount * 2)}**\n\n<@${target.id}>, do you accept?`,
			),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta('60 seconds to respond')));
		c.addActionRowComponents(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(acceptId).setLabel('Accept').setStyle(ButtonStyle.Success),
				new ButtonBuilder().setCustomId(declineId).setLabel('Decline').setStyle(ButtonStyle.Secondary),
			),
		);

		const reply = await interaction.editReply({ components: [c], flags: CV2_FLAG as any });

		const timer = setTimeout(async () => {
			pendingDuels.delete(interaction.user.id);
			const expired = makeContainer({ color: Colors.Neutral });
			expired.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`Duel expired — <@${target.id}> didn't respond in time.`),
			);
			await interaction.editReply({ components: [expired], flags: CV2_FLAG as any }).catch(() => null);
		}, 60_000);

		pendingDuels.set(interaction.user.id, {
			challengerId: interaction.user.id,
			targetId: target.id,
			amount,
			guildId: interaction.guildId!,
			timer,
		});

		const collector = reply.createMessageComponentCollector<ComponentType.Button>({
			filter: (i) => i.user.id === target.id && (i.customId === acceptId || i.customId === declineId),
			time: 60_000,
			max: 1,
		});

		collector.on('collect', async (i) => {
			const duel = pendingDuels.get(interaction.user.id);
			if (!duel) return;
			clearTimeout(duel.timer);
			pendingDuels.delete(interaction.user.id);

			if (i.customId === declineId) {
				const declined = makeContainer({ color: Colors.Neutral });
				declined.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@${target.id}> declined the duel.`));
				await interaction.editReply({ components: [declined], flags: CV2_FLAG as any }).catch(() => null);
				await i.deferUpdate().catch(() => null);
				return;
			}

			if ((await isBotBlacklisted(i.user.id)) || (await isBotBlacklisted(interaction.user.id))) {
				const blocked = makeContainer({ color: Colors.Error });
				blocked.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatBlacklistDenial(null)));
				await interaction.editReply({ components: [blocked], flags: CV2_FLAG as any }).catch(() => null);
				await i.reply({ content: formatBlacklistDenial(null), flags: MessageFlags.Ephemeral }).catch(() => null);
				return;
			}

			// Accept — re-check both balances
			const [cRow, tRow] = await Promise.all([
				getOrCreateEconomy(interaction.user.id, duel.guildId),
				getOrCreateEconomy(target.id, duel.guildId),
			]);

			if (cRow.balance < duel.amount || tRow.balance < duel.amount) {
				const broke = makeContainer({ color: Colors.Error });
				broke.addTextDisplayComponents(
					new TextDisplayBuilder().setContent("Someone doesn't have enough coins — duel cancelled."),
				);
				await interaction.editReply({ components: [broke], flags: CV2_FLAG as any }).catch(() => null);
				await i.deferUpdate().catch(() => null);
				return;
			}

			// Resolve
			const challengerWins = Math.random() < 0.5;
			const [winnerId, loserId] = challengerWins ? [interaction.user.id, target.id] : [target.id, interaction.user.id];

			await walletDeduct(interaction.user.id, duel.guildId, duel.amount);
			await walletDeduct(target.id, duel.guildId, duel.amount);
			await walletAdd(winnerId, duel.guildId, duel.amount * 2);

			await logTx(duel.guildId, winnerId, 'duel_win', duel.amount, { toUserId: loserId });
			await logTx(duel.guildId, loserId, 'duel_loss', duel.amount, { toUserId: winnerId });

			const result = makeContainer({ color: challengerWins ? Colors.Success : Colors.Error, header: 'Duel Result' });
			result.addSeparatorComponents(separator());
			result.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`**${challengerWins ? interaction.user.displayName : target.displayName}** wins the duel!\n\n<@${winnerId}> takes ${fmtCoins(duel.amount * 2)}\n-# <@${loserId}> loses ${fmtCoins(duel.amount)}`,
				),
			);
			await interaction.editReply({ components: [result], flags: CV2_FLAG as any }).catch(() => null);
			await i.deferUpdate().catch(() => null);
		});
	}

	// ── slots ──────────────────────────────────────────────────────────────────

	public async runSlots(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const bet = interaction.options.getInteger('bet', true);
		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, bet);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(bet)}, have ${fmtCoins(row.balance)}.`));
		}

		const spin = () => SLOT_POOL[Math.floor(Math.random() * SLOT_POOL.length)];
		const reels = [spin(), spin(), spin()];
		const display = `[ ${reels.join('  ')} ]`;

		let multiplier = 0;
		let resultLabel = '';
		if (reels[0] === reels[1] && reels[1] === reels[2]) {
			multiplier = SLOT_PAYOUT[reels[0]] ?? 2;
			resultLabel = multiplier >= 10 ? '🎉 JACKPOT!' : 'Three of a kind!';
		} else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) {
			multiplier = 1;
			resultLabel = 'Two of a kind — bet returned.';
		} else {
			resultLabel = 'No match.';
		}

		const payout = Math.floor(bet * multiplier);
		if (payout > 0) await walletAdd(interaction.user.id, interaction.guild!.id, payout);
		await logTx(
			interaction.guild!.id,
			interaction.user.id,
			payout > bet ? 'slots_win' : 'slots_loss',
			Math.abs(payout - bet),
			{ note: reels.join('') },
		);

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const net = payout - bet;
		const netStr = net >= 0 ? `+${net.toLocaleString()}` : net.toLocaleString();
		const c = makeContainer({ color: net >= 0 ? Colors.Success : Colors.Error, header: 'Slot Machine' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ${display}\n${resultLabel}\n-# Bet: ${bet.toLocaleString()} ${CURRENCY}  ·  Net: **${netStr} ${CURRENCY}**  ·  Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── roulette ───────────────────────────────────────────────────────────────

	public async runRoulette(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const bet = interaction.options.getInteger('bet', true);
		const color = interaction.options.getString('color', true) as 'red' | 'black' | 'green';
		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, bet);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(bet)}, have ${fmtCoins(row.balance)}.`));
		}

		const n = Math.floor(Math.random() * 37); // 0–36
		const landed: 'green' | 'red' | 'black' = n === 0 ? 'green' : n % 2 === 0 ? 'black' : 'red';
		const mult = color === 'green' ? 14 : 2;
		const won = landed === color;
		const payout = won ? bet * mult : 0;
		if (payout > 0) await walletAdd(interaction.user.id, interaction.guild!.id, payout);
		await logTx(
			interaction.guild!.id,
			interaction.user.id,
			won ? 'roulette_win' : 'roulette_loss',
			won ? payout - bet : bet,
			{
				note: `${color} vs ${landed} (${n})`,
			},
		);

		const c = makeContainer({ color: won ? Colors.Success : Colors.Error, header: 'Roulette' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Ball landed on **${n} ${landed}**\nYou bet **${color}** — ${won ? `won ${fmtCoins(payout)}!` : 'lost.'}`,
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── scratch ────────────────────────────────────────────────────────────────

	public async runScratch(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const cost = interaction.options.getInteger('tier') ?? 100;
		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, cost);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(cost)}, have ${fmtCoins(row.balance)}.`));
		}

		const roll = Math.random();
		let payout = 0;
		if (roll < 0.01) payout = cost * 20;
		else if (roll < 0.05) payout = cost * 5;
		else if (roll < 0.2) payout = cost * 2;
		else if (roll < 0.4) payout = cost;

		if (payout > 0) await walletAdd(interaction.user.id, interaction.guild!.id, payout);
		await logTx(
			interaction.guild!.id,
			interaction.user.id,
			payout > cost ? 'scratch_win' : 'scratch_loss',
			Math.abs(payout - cost),
			{ note: `Scratch tier ${cost}` },
		);

		const c = makeContainer({ color: payout > 0 ? Colors.Success : Colors.Error, header: 'Scratch ticket' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				payout > 0 ? `You scratched **${fmtCoins(payout)}**!` : 'Better luck next time — nothing under the foil.',
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── coinflip ───────────────────────────────────────────────────────────────

	public async runCoinflip(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const bet = interaction.options.getInteger('bet', true);
		const side = interaction.options.getString('side', true) as 'heads' | 'tails';
		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, bet);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(bet)}, have ${fmtCoins(row.balance)}.`));
		}

		let loadedNote = '';
		const loaded = await getInventoryItem(interaction.user.id, interaction.guild!.id, 'loaded_coin');
		let result: 'heads' | 'tails';
		if (loaded && side === 'heads') {
			result = 'heads';
			await consumeItem(interaction.user.id, interaction.guild!.id, loaded.inv.id, loaded.inv.quantity);
			loadedNote = '\n🪙 Loaded Coin forced heads!';
		} else {
			result = Math.random() < 0.5 ? 'heads' : 'tails';
		}
		const win = result === side;
		const payout = win ? bet * 2 : 0;
		if (payout > 0) await walletAdd(interaction.user.id, interaction.guild!.id, payout);
		await logTx(interaction.guild!.id, interaction.user.id, win ? 'coinflip_win' : 'coinflip_loss', bet, {
			note: `${side} vs ${result}`,
		});

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		const c = makeContainer({ color: win ? Colors.Success : Colors.Error, header: 'Coin Flip' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`**${result.toUpperCase()}!** ${win ? `You win ${fmtCoins(bet)}!` : `You lose ${fmtCoins(bet)}.`}${loadedNote}\n-# You picked **${side}**  ·  Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── blackjack ──────────────────────────────────────────────────────────────

	public async runBlackjack(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const bet = interaction.options.getInteger('bet', true);
		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, bet);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(bet)}, have ${fmtCoins(row.balance)}.`));
		}

		const deck = shuffleDeck(buildDeck());
		const player: BjCard[] = [deck.pop()!, deck.pop()!];
		const dealer: BjCard[] = [deck.pop()!, deck.pop()!];

		const gameId = Math.random().toString(36).slice(2, 8);
		const hitId = `bj_hit_${gameId}`;
		const standId = `bj_stand_${gameId}`;

		const buildDisplay = (hideDealer = true, footer?: string, color: number = Colors.Info) => {
			const c = makeContainer({ color });
			const text = footer ? footer : `Bet: **${bet.toLocaleString()}** ${CURRENCY}`;

			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
			c.addSeparatorComponents(separator());

			// Draw canvas blackjack board
			const boardBuffer = drawBlackjackBoard(player, dealer, hideDealer);
			const attachmentName = `bj-${gameId}-${player.length}-${dealer.length}.png`;
			const file = new AttachmentBuilder(boardBuffer, { name: attachmentName });

			c.addMediaGalleryComponents(
				new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)),
			);

			if (!footer) {
				c.addActionRowComponents(
					new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder().setCustomId(hitId).setLabel('Hit').setStyle(ButtonStyle.Primary),
						new ButtonBuilder().setCustomId(standId).setLabel('Stand').setStyle(ButtonStyle.Secondary),
					),
				);
			}
			return { container: c, file };
		};

		if (handTotal(player) === 21) {
			const payout = Math.floor(bet * 2.5);
			await walletAdd(interaction.user.id, interaction.guild!.id, payout);
			await logTx(interaction.guild!.id, interaction.user.id, 'blackjack_win', payout - bet, { note: 'Blackjack!' });
			const { container, file } = buildDisplay(
				false,
				`✨ Blackjack! You win ${fmtCoins(payout)} (2.5×)!`,
				Colors.Success,
			);
			return interaction.editReply({
				components: [container],
				files: [file],
				flags: CV2_FLAG as any,
			});
		}

		const initialDisplay = buildDisplay();
		const reply = await interaction.editReply({
			components: [initialDisplay.container],
			files: [initialDisplay.file],
			flags: CV2_FLAG as any,
		});

		const resolveGame = async () => {
			while (handTotal(dealer) < 17) dealer.push(deck.pop()!);
			const pt = handTotal(player);
			const dt = handTotal(dealer);
			let footer: string;
			let color: number;
			let txType: 'blackjack_win' | 'blackjack_loss' | 'blackjack_tie';
			let payout = 0;
			if (dt > 21 || pt > dt) {
				payout = bet * 2;
				await walletAdd(interaction.user.id, interaction.guild!.id, payout);
				txType = 'blackjack_win';
				footer = `You win ${fmtCoins(bet)}! (You: **${pt}** | Dealer: **${dt}**)`;
				color = Colors.Success;
			} else if (pt === dt) {
				payout = bet;
				await walletAdd(interaction.user.id, interaction.guild!.id, payout);
				txType = 'blackjack_tie';
				footer = `Push at **${pt}** — bet returned.`;
				color = Colors.Warning;
			} else {
				txType = 'blackjack_loss';
				footer = `Dealer wins! (Dealer: **${dt}** | You: **${pt}**) Lost ${fmtCoins(bet)}.`;
				color = Colors.Error;
			}
			await logTx(interaction.guild!.id, interaction.user.id, txType, Math.abs(payout - bet), { note: footer });
			return { footer, color };
		};

		let ended = false;
		const collector = reply.createMessageComponentCollector<ComponentType.Button>({
			filter: (i) => i.user.id === interaction.user.id && (i.customId === hitId || i.customId === standId),
			time: 45_000,
		});

		collector.on('collect', async (i) => {
			if (ended) return;
			if (i.customId === hitId) {
				player.push(deck.pop()!);
				const total = handTotal(player);
				if (total > 21) {
					ended = true;
					collector.stop();
					await logTx(interaction.guild!.id, interaction.user.id, 'blackjack_loss', bet, { note: 'Bust' });
					const { container, file } = buildDisplay(false, `Bust at **${total}**! Lost ${fmtCoins(bet)}.`, Colors.Error);
					await i.update({
						components: [container],
						files: [file],
						flags: CV2_FLAG as any,
					});
					return;
				}
				if (total === 21) {
					ended = true;
					collector.stop();
					const { footer, color } = await resolveGame();
					const { container, file } = buildDisplay(false, footer, color);
					await i.update({
						components: [container],
						files: [file],
						flags: CV2_FLAG as any,
					});
					return;
				}
				const { container, file } = buildDisplay();
				await i.update({
					components: [container],
					files: [file],
					flags: CV2_FLAG as any,
				});
			} else {
				ended = true;
				collector.stop();
				const { footer, color } = await resolveGame();
				const { container, file } = buildDisplay(false, footer, color);
				await i.update({
					components: [container],
					files: [file],
					flags: CV2_FLAG as any,
				});
			}
		});

		collector.on('end', async (_, _reason) => {
			if (ended) return;
			ended = true;
			await walletAdd(interaction.user.id, interaction.guild!.id, bet);
			const { container, file } = buildDisplay(false, `Timed out — bet of ${fmtCoins(bet)} returned.`, Colors.Warning);
			await interaction.editReply({
				components: [container],
				files: [file],
				flags: CV2_FLAG as any,
			});
		});
	}

	// ── inventory ──────────────────────────────────────────────────────────────

	public async runInventory(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const target = interaction.options.getUser('user') ?? interaction.user;
		const isSelf = target.id === interaction.user.id;

		const rows = await db.query.userInventory.findMany({
			where: and(eq(schema.userInventory.guildId, interaction.guild!.id), eq(schema.userInventory.userId, target.id)),
		});

		const c = makeContainer({ color: Colors.Info, header: `${isSelf ? 'Your' : `${target.username}'s`} Inventory` });
		c.addSeparatorComponents(separator());

		if (!rows.length) {
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					isSelf ? 'Your inventory is empty. Buy items with `/economy shop buy`.' : 'This user has nothing.',
				),
			);
		} else {
			const items = await db.query.shopItems.findMany({ where: eq(schema.shopItems.guildId, interaction.guild!.id) });
			const itemMap = new Map(items.map((i) => [i.id, i]));
			const lines = rows
				.filter((r) => r.quantity > 0)
				.map((r) => {
					const item = itemMap.get(r.itemId);
					const name = item?.name ?? `Item #${r.itemId}`;
					const desc = item?.description ? ` — ${item.description}` : '';
					return `**${name}** ×${r.quantity}${desc}`;
				});
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n') || 'No items.'));
		}

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── use ────────────────────────────────────────────────────────────────────

	public async runUse(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const itemName = interaction.options.getString('item', true).trim();
		const item = await db.query.shopItems.findFirst({
			where: and(eq(schema.shopItems.guildId, interaction.guild!.id), eq(schema.shopItems.name, itemName)),
		});
		if (!item || item.type !== 'consumable')
			return interaction.editReply(errorReply(`No consumable named **${itemName}** found.`));

		const invRow = await db.query.userInventory.findFirst({
			where: and(
				eq(schema.userInventory.guildId, interaction.guild!.id),
				eq(schema.userInventory.userId, interaction.user.id),
				eq(schema.userInventory.itemId, item.id),
			),
		});
		if (!invRow || invRow.quantity < 1)
			return interaction.editReply(errorReply(`You don't have **${itemName}** in your inventory.`));

		// Passive items — stay in inventory until triggered
		if (item.itemKey === 'robbery_shield') {
			return interaction.editReply(
				successReply(
					'🛡️ Robbery Shield is already equipped in your inventory — it auto-blocks the next successful rob.',
				),
			);
		}
		if (item.itemKey === 'xp_token') {
			return interaction.editReply(successReply('✨ XP Token is a collectible flex item — keep it in your inventory.'));
		}
		if (item.itemKey === 'vip_pass') {
			return interaction.editReply(successReply('👑 VIP Pass is a flex collectible — keep it in your inventory.'));
		}
		if (
			item.itemKey === 'gamblers_dice' ||
			item.itemKey === 'insurance' ||
			item.itemKey === 'loaded_coin' ||
			item.itemKey === 'golden_hook' ||
			item.itemKey === 'diamond_pick' ||
			item.itemKey === 'beg_bowl' ||
			item.itemKey === 'crime_spree'
		) {
			return interaction.editReply(
				successReply(`**${item.name}** stays in your inventory and activates automatically when relevant.`),
			);
		}

		await consumeItem(interaction.user.id, interaction.guild!.id, invRow.id, invRow.quantity);

		// ── Effect: padlock ─────────────────────────────────────────────────────
		if (item.itemKey === 'padlock') {
			const ecoRow = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			if (ecoRow.padlockExpiresAt && ecoRow.padlockExpiresAt.getTime() > Date.now()) {
				return interaction.editReply(
					warningReply(
						`Padlock already active — expires <t:${Math.floor(ecoRow.padlockExpiresAt.getTime() / 1000)}:R>.`,
					),
				);
			}
			const hours = item.durationHours ?? 24;
			const expiresAt = new Date(Date.now() + hours * 3_600_000);
			await db
				.update(schema.economy)
				.set({ padlockExpiresAt: expiresAt })
				.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
			return interaction.editReply(
				successReply(
					`🔒 Padlock activated! Wallet protected for **${hours}h** (expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>).`,
				),
			);
		}

		// ── Effect: bank_upgrade ────────────────────────────────────────────────
		if (item.itemKey === 'bank_upgrade') {
			await db
				.update(schema.economy)
				.set({ bankCap: sql`${schema.economy.bankCap} + 5000` })
				.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
			const updated = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(
				successReply(`🏦 Bank upgraded! New capacity: **${updated.bankCap.toLocaleString()}** ${CURRENCY}.`),
			);
		}

		// ── Effect: loot_crate ──────────────────────────────────────────────────
		if (item.itemKey === 'loot_crate') {
			const payout = rand(500, 4000);
			await walletAdd(interaction.user.id, interaction.guild!.id, payout);
			await logTx(interaction.guild!.id, interaction.user.id, 'loot_crate', payout, { note: 'Loot crate' });
			return interaction.editReply(successReply(`📦 You opened a loot crate and found ${fmtCoins(payout)}!`));
		}

		if (item.itemKey === 'mega_crate') {
			const payout = rand(2000, 15_000);
			await walletAdd(interaction.user.id, interaction.guild!.id, payout);
			await logTx(interaction.guild!.id, interaction.user.id, 'mega_crate', payout, { note: 'Mega crate' });
			return interaction.editReply(successReply(`🎁 Mega crate exploded into ${fmtCoins(payout)}!`));
		}

		if (item.itemKey === 'jackpot_ticket') {
			const roll = Math.random();
			let payout = 0;
			if (roll < 0.005) payout = item.cost * 200;
			else if (roll < 0.02) payout = item.cost * 50;
			else if (roll < 0.08) payout = item.cost * 10;
			else if (roll < 0.25) payout = item.cost * 2;
			if (payout > 0) await walletAdd(interaction.user.id, interaction.guild!.id, payout);
			await logTx(interaction.guild!.id, interaction.user.id, 'jackpot_ticket', payout || item.cost, {
				note: payout > 0 ? `Jackpot hit ${payout}` : 'Jackpot miss',
			});
			return interaction.editReply(
				payout > 0
					? successReply(`🎟️ JACKPOT ticket paid ${fmtCoins(payout)}!`)
					: warningReply('🎟️ The ticket was a dud. Pain.'),
			);
		}

		if (item.itemKey === 'vault_expansion') {
			await db
				.update(schema.economy)
				.set({ bankCap: sql`${schema.economy.bankCap} + 15000` })
				.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
			const updated = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(
				successReply(`🏛️ Vault expanded! New capacity: **${updated.bankCap.toLocaleString()}** ${CURRENCY}.`),
			);
		}

		// ── Effect: work_boost ──────────────────────────────────────────────────
		if (item.itemKey === 'work_boost') {
			const ecoRow = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			if (ecoRow.workBoostExpiresAt && ecoRow.workBoostExpiresAt.getTime() > Date.now()) {
				return interaction.editReply(
					warningReply(
						`Work Boost already active — expires <t:${Math.floor(ecoRow.workBoostExpiresAt.getTime() / 1000)}:R>.`,
					),
				);
			}
			const hours = item.durationHours ?? 12;
			const expiresAt = new Date(Date.now() + hours * 3_600_000);
			await db
				.update(schema.economy)
				.set({ workBoostExpiresAt: expiresAt })
				.where(and(eq(schema.economy.userId, interaction.user.id), eq(schema.economy.guildId, interaction.guild!.id)));
			return interaction.editReply(
				successReply(
					`⚡ Work Boost active! 2× work earnings for **${hours}h** (expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>).`,
				),
			);
		}

		// ── Passive items (heist_kit, lucky_charm, streak_freeze) ───────────────
		// These are consumed automatically when the relevant command runs.
		if (item.itemKey === 'heist_kit')
			return interaction.editReply(
				warningReply('The Heist Kit activates automatically on your next `/economy earn crime`.'),
			);
		if (item.itemKey === 'lucky_charm')
			return interaction.editReply(
				warningReply('The Lucky Charm applies automatically on your next `/economy daily`.'),
			);
		if (item.itemKey === 'streak_freeze')
			return interaction.editReply(
				warningReply('The Streak Freeze activates automatically if your daily streak is about to break.'),
			);

		return interaction.editReply(successReply(`Used **${item.name}**.`));
	}

	// ── leaderboard ────────────────────────────────────────────────────────────

	public async runLeaderboard(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		const rows = await db.query.economy.findMany({
			where: eq(schema.economy.guildId, interaction.guild!.id),
			orderBy: [desc(sql`${schema.economy.balance} + ${schema.economy.bank}`)],
			limit: 10,
		});
		if (!rows.length) return interaction.editReply(errorReply('No economy data yet.'));

		const medals = ['🥇', '🥈', '🥉'];
		const lines = rows.map((r, i) => {
			const total = r.balance + r.bank;
			const isSelf = r.userId === interaction.user.id ? ' ← you' : '';
			return `${medals[i] ?? `**${i + 1}.**`} <@${r.userId}> — **${total.toLocaleString()}** ${CURRENCY}${isSelf}`;
		});

		const c = makeContainer({ color: Colors.Info, header: 'Leaderboard' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(meta(`Top ${rows.length} by net worth`)));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── transactions ───────────────────────────────────────────────────────────

	public async runTransactions(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		const requestedUser = interaction.options.getUser('user');
		const canViewOthers = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
		if (requestedUser && !canViewOthers && requestedUser.id !== interaction.user.id)
			return interaction.editReply(errorReply("Need Manage Server to view other users' transactions."));
		const target = requestedUser ?? interaction.user;

		const txs = await db.query.economyTransactions.findMany({
			where: and(
				eq(schema.economyTransactions.guildId, interaction.guild!.id),
				eq(schema.economyTransactions.userId, target.id),
			),
			orderBy: [desc(schema.economyTransactions.createdAt)],
			limit: 15,
		});

		const TX_EMOJI: Record<string, string> = {
			daily: '📅',
			weekly: '📆',
			monthly: '🗓️',
			pay_sent: '📤',
			pay_received: '📥',
			shop_buy: '🛒',
			work: '💼',
			crime: '🦹',
			rob_taken: '💰',
			rob_lost: '💸',
			slots_win: '🎰',
			slots_loss: '🎰',
			coinflip_win: '🪙',
			coinflip_loss: '🪙',
			blackjack_win: '🃏',
			blackjack_loss: '🃏',
			blackjack_tie: '🃏',
			deposit: '🏦',
			withdraw: '🏧',
			fish: '🎣',
			mine: '⛏️',
			scavenge: '🧺',
			duel_win: '⚔️',
			duel_loss: '⚔️',
			roulette_win: '🎡',
			roulette_loss: '🎡',
			scratch_win: '🎫',
			scratch_loss: '🎫',
			loot_crate: '📦',
			mega_crate: '🎁',
			jackpot_ticket: '🎟️',
			dice_win: '🎲',
			dice_loss: '🎲',
			crash_win: '🚀',
			crash_loss: '💥',
			horse_win: '🐴',
			mines_win: '💣',
			wheel_win: '🎡',
			plinko_win: '🟣',
			tower_win: '🗼',
		};
		const DEBIT = new Set([
			'pay_sent',
			'shop_buy',
			'rob_lost',
			'slots_loss',
			'coinflip_loss',
			'blackjack_loss',
			'crime',
			'deposit',
			'duel_loss',
			'roulette_loss',
			'scratch_loss',
			'dice_loss',
			'rps_loss',
			'crash_loss',
			'horse_loss',
			'lottery_loss',
			'mines_loss',
			'wheel_loss',
			'highlow_loss',
			'baccarat_loss',
			'poker_loss',
			'plinko_loss',
			'keno_loss',
			'limbo_loss',
			'war_loss',
			'sicbo_loss',
			'tower_loss',
			'gamble_loss',
		]);

		const isSelf = target.id === interaction.user.id;
		const c = makeContainer({
			color: Colors.Info,
			header: `${isSelf ? 'Your' : `${target.username}'s`} Transactions`,
		});
		c.addSeparatorComponents(separator());

		if (!txs.length) {
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent('No transactions yet.'));
		} else {
			const lines = txs.map((tx) => {
				const emoji = TX_EMOJI[tx.type] ?? '💰';
				const sign = DEBIT.has(tx.type) ? '−' : '+';
				const ts = Math.floor(new Date(tx.createdAt).getTime() / 1000);
				return `${emoji} **${sign}${tx.amount.toLocaleString()}** ${CURRENCY} — ${tx.note ?? tx.type} · <t:${ts}:R>`;
			});
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
			c.addSeparatorComponents(separator());
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(meta(`Last ${txs.length} transaction${txs.length === 1 ? '' : 's'}`)),
			);
		}

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── shop list ──────────────────────────────────────────────────────────────

	public async runShopList(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await ecoGuard(interaction))) return;

		await ensureShopSeeded(interaction.guild!.id);
		const items = await db.query.shopItems.findMany({ where: eq(schema.shopItems.guildId, interaction.guild!.id) });
		if (!items.length) return interaction.editReply(errorReply('The shop has no items.'));

		const lines = items.map((item) => {
			const key = item.itemKey ?? '';
			const tagMap: Record<string, string> = {
				padlock: '🔒 Protection',
				bank_upgrade: '🏦 Permanent',
				heist_kit: '🧰 One-use',
				lucky_charm: '🍀 One-use',
				streak_freeze: '🧊 One-use',
				work_boost: '⚡ Timed',
			};
			const tag = tagMap[key] ? ` \`${tagMap[key]}\`` : '';
			return `**${item.name}** — ${item.cost.toLocaleString()} ${CURRENCY}${tag}\n-# ${item.description ?? ''}`;
		});

		const c = makeContainer({ color: Colors.Info, header: 'Shop' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(meta(`${items.length} items · /economy shop buy <name> to purchase`)),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ── shop buy ───────────────────────────────────────────────────────────────

	public async runShopBuy(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		await ensureShopSeeded(interaction.guild!.id);
		const itemName = interaction.options.getString('item', true).trim();
		const item = await db.query.shopItems.findFirst({
			where: and(eq(schema.shopItems.guildId, interaction.guild!.id), eq(schema.shopItems.name, itemName)),
		});
		if (!item)
			return interaction.editReply(
				errorReply(`No item named **${itemName}** found. Use \`/economy shop list\` to browse.`),
			);

		const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, item.cost);
		if (!ok) {
			const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
			return interaction.editReply(errorReply(`Need ${fmtCoins(item.cost)} but only have ${fmtCoins(row.balance)}.`));
		}

		// Role items
		if (item.type === 'role' && item.roleId) {
			const member = interaction.member as GuildMember | null;
			if (member?.roles && 'cache' in member.roles && member.roles.cache.has(item.roleId)) {
				await walletAdd(interaction.user.id, interaction.guild!.id, item.cost);
				return interaction.editReply(errorReply(`You already own **${item.name}**.`));
			}
			try {
				if (!member?.roles || !('add' in member.roles)) throw new Error('Member roles are unavailable');
				await member.roles.add(item.roleId);
			} catch {
				await walletAdd(interaction.user.id, interaction.guild!.id, item.cost);
				return interaction.editReply(
					errorReply(`I could not grant **${item.name}**. Your ${fmtCoins(item.cost)} was refunded.`),
				);
			}
			await logTx(interaction.guild!.id, interaction.user.id, 'shop_buy', item.cost, { note: `Bought: ${item.name}` });
			return interaction.editReply(successReply(`Purchased **${item.name}**! You now have <@&${item.roleId}>.`));
		}

		// Consumable → inventory
		try {
			await db
				.insert(schema.userInventory)
				.values({ guildId: interaction.guild!.id, userId: interaction.user.id, itemId: item.id, quantity: 1 })
				.onDuplicateKeyUpdate({
					set: { quantity: sql`${schema.userInventory.quantity} + 1` },
				});
		} catch (err) {
			await walletAdd(interaction.user.id, interaction.guild!.id, item.cost);
			throw err;
		}
		await logTx(interaction.guild!.id, interaction.user.id, 'shop_buy', item.cost, { note: `Bought: ${item.name}` });

		const passiveKeys = new Set([
			'heist_kit',
			'lucky_charm',
			'streak_freeze',
			'robbery_shield',
			'gamblers_dice',
			'insurance',
			'loaded_coin',
			'golden_hook',
			'diamond_pick',
			'beg_bowl',
			'crime_spree',
			'xp_token',
			'vip_pass',
		]);
		const useHint = passiveKeys.has(item.itemKey ?? '')
			? 'This item activates automatically when needed (or is a collectible).'
			: `Use it with \`/economy use ${item.name}\`.`;

		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		return interaction.editReply(
			successReply(`Purchased **${item.name}**! ${useHint}\n-# Wallet: ${fmtCoins(row.balance)}`),
		);
	}

	// ── admin give ─────────────────────────────────────────────────────────────
	public async runAdminGive(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You do not have permission to manage the server economy.'));
		}

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot give coins to a bot.'));

		await getOrCreateEconomy(target.id, interaction.guild!.id);
		await walletAdd(target.id, interaction.guild!.id, amount);
		await logTx(interaction.guild!.id, target.id, 'admin_add', amount, {
			note: `Given by staff: ${interaction.user.tag}`,
		});

		const row = await getOrCreateEconomy(target.id, interaction.guild!.id);

		return interaction.editReply(
			successReply(
				`Successfully gave ${fmtCoins(amount)} to <@${target.id}>.\n` +
					`-# Target's New Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── admin take ─────────────────────────────────────────────────────────────
	public async runAdminTake(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You do not have permission to manage the server economy.'));
		}

		const target = interaction.options.getUser('user', true);
		const amount = interaction.options.getInteger('amount', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot take coins from a bot.'));

		const row = await getOrCreateEconomy(target.id, interaction.guild!.id);
		const toTake = Math.min(amount, row.balance);
		if (toTake > 0) {
			await walletDeduct(target.id, interaction.guild!.id, toTake);
			await logTx(interaction.guild!.id, target.id, 'admin_remove', toTake, {
				note: `Taken by staff: ${interaction.user.tag}`,
			});
		}

		const updatedRow = await getOrCreateEconomy(target.id, interaction.guild!.id);

		return interaction.editReply(
			successReply(
				`Successfully took ${fmtCoins(toTake)} from <@${target.id}>'s wallet.\n` +
					`-# Target's New Wallet: ${updatedRow.balance.toLocaleString()} ${CURRENCY}`,
			),
		);
	}

	// ── admin reset ────────────────────────────────────────────────────────────
	public async runAdminReset(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await ecoGuard(interaction))) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			return interaction.editReply(errorReply('You do not have permission to manage the server economy.'));
		}

		const target = interaction.options.getUser('user', true);
		if (target.bot) return interaction.editReply(errorReply('Cannot reset a bot.'));

		await db
			.update(schema.economy)
			.set({ balance: 0, bank: 0, dailyStreak: 0 })
			.where(and(eq(schema.economy.userId, target.id), eq(schema.economy.guildId, interaction.guild!.id)));

		await logTx(interaction.guild!.id, target.id, 'admin_reset', 0, {
			note: `Reset by staff: ${interaction.user.tag}`,
		});

		return interaction.editReply(
			successReply(`Successfully reset all economy progress (wallet, bank, daily streak) for <@${target.id}>.`),
		);
	}
}
