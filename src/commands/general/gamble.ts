import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import { MessageFlags, TextDisplayBuilder } from 'discord.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator } from '../../lib/components.js';
import {
	baccaratHand,
	clampBet,
	crashPoint,
	generateMinesBoard,
	HORSE_NAMES,
	LOTTERY_PAYOUT,
	lotteryDraw,
	lotteryMatches,
	minesMultiplier,
	raceHorses,
	rollDice,
	spinWheel,
} from '../../lib/EconomyGamble.js';
import {
	CURRENCY,
	consumeItem,
	fmtCoins,
	getInventoryItem,
	getOrCreateEconomy,
	logTx,
	type TxType,
	walletAdd,
	walletDeduct,
} from '../../lib/EconomyUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

const MAX_BET = 250_000;

async function guard(interaction: Subcommand.ChatInputCommandInteraction): Promise<boolean> {
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

async function settle(
	interaction: Subcommand.ChatInputCommandInteraction,
	bet: number,
	payout: number,
	winType: TxType,
	lossType: TxType,
	header: string,
	body: string,
): Promise<void> {
	const guildId = interaction.guild!.id;
	const userId = interaction.user.id;
	const net = payout - bet;

	if (payout > 0) {
		let credit = payout;
		if (net > 0) {
			const dice = await getInventoryItem(userId, guildId, 'gamblers_dice');
			if (dice) {
				credit = bet + Math.floor(net * 1.25);
				await consumeItem(userId, guildId, dice.inv.id, dice.inv.quantity);
				body += `\n🎲 Gambler's Dice boosted winnings (+25% net)!`;
			}
		}
		await walletAdd(userId, guildId, credit);
		await logTx(guildId, userId, winType, Math.max(credit - bet, 0), { note: header });
	} else {
		const insurance = await getInventoryItem(userId, guildId, 'insurance');
		if (insurance) {
			const refund = Math.floor(bet * 0.5);
			await walletAdd(userId, guildId, refund);
			await consumeItem(userId, guildId, insurance.inv.id, insurance.inv.quantity);
			body += `\n🛡️ Insurance refunded ${fmtCoins(refund)}.`;
		}
		await logTx(guildId, userId, lossType, bet, { note: header });
	}

	const row = await getOrCreateEconomy(userId, guildId);
	const won = payout > 0;
	const c = makeContainer({ color: won ? Colors.Success : Colors.Error, header });
	c.addSeparatorComponents(separator());
	c.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`${body}\n-# Bet: ${bet.toLocaleString()} ${CURRENCY}  ·  Payout: ${payout.toLocaleString()} ${CURRENCY}  ·  Wallet: ${row.balance.toLocaleString()} ${CURRENCY}`,
		),
	);
	await interaction.editReply({ components: [c], flags: CV2_FLAG as any });
}

async function takeBet(interaction: Subcommand.ChatInputCommandInteraction, rawBet: number): Promise<number | null> {
	const bet = clampBet(rawBet, MAX_BET);
	const ok = await walletDeduct(interaction.user.id, interaction.guild!.id, bet);
	if (!ok) {
		const row = await getOrCreateEconomy(interaction.user.id, interaction.guild!.id);
		await interaction.editReply(errorReply(`Need ${fmtCoins(bet)}, have ${fmtCoins(row.balance)}.`));
		return null;
	}
	return bet;
}

@ApplyOptions<Subcommand.Options>({
	name: 'gamble',
	description: 'Casino — bet your economy coins.',
	subcommands: [
		{ name: 'help', chatInputRun: 'runHelp' },
		{ name: 'duel', chatInputRun: 'runDuel' },
		{
			name: 'classic',
			type: 'group',
			entries: [
				{ name: 'slots', chatInputRun: 'runSlots' },
				{ name: 'roulette', chatInputRun: 'runRoulette' },
				{ name: 'scratch', chatInputRun: 'runScratch' },
				{ name: 'coinflip', chatInputRun: 'runCoinflip' },
				{ name: 'blackjack', chatInputRun: 'runBlackjack' },
			],
		},
		{
			name: 'quick',
			type: 'group',
			entries: [
				{ name: 'dice', chatInputRun: 'runDice' },
				{ name: 'rps', chatInputRun: 'runRps' },
				{ name: 'war', chatInputRun: 'runWar' },
				{ name: 'highlow', chatInputRun: 'runHighlow' },
			],
		},
		{
			name: 'table',
			type: 'group',
			entries: [
				{ name: 'baccarat', chatInputRun: 'runBaccarat' },
				{ name: 'poker', chatInputRun: 'runPoker' },
				{ name: 'sicbo', chatInputRun: 'runSicbo' },
				{ name: 'horse', chatInputRun: 'runHorse' },
			],
		},
		{
			name: 'risk',
			type: 'group',
			entries: [
				{ name: 'crash', chatInputRun: 'runCrash' },
				{ name: 'limbo', chatInputRun: 'runLimbo' },
				{ name: 'mines', chatInputRun: 'runMines' },
				{ name: 'tower', chatInputRun: 'runTower' },
				{ name: 'wheel', chatInputRun: 'runWheel' },
				{ name: 'plinko', chatInputRun: 'runPlinko' },
			],
		},
		{
			name: 'tickets',
			type: 'group',
			entries: [
				{ name: 'lottery', chatInputRun: 'runLottery' },
				{ name: 'keno', chatInputRun: 'runKeno' },
			],
		},
	],
})
export class GambleCommand extends Subcommand {
	private eco(): any {
		return this.container.stores.get('commands').get('economy');
	}

	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) =>
			builder
				.setName('gamble')
				.setDescription('Casino — bet your economy coins.')
				.addSubcommand((s) => s.setName('help').setDescription('Map of every casino game.'))
				.addSubcommand((s) =>
					s
						.setName('duel')
						.setDescription('Challenge someone to a coin duel.')
						.addUserOption((o) => o.setName('user').setDescription('Who to challenge.').setRequired(true))
						.addIntegerOption((o) =>
							o.setName('amount').setDescription('Coins to bet (each).').setRequired(true).setMinValue(50),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('classic')
						.setDescription('Familiar casino staples.')
						.addSubcommand((s) =>
							s
								.setName('slots')
								.setDescription('Spin the slot machine.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10)),
						)
						.addSubcommand((s) =>
							s
								.setName('roulette')
								.setDescription('Bet on red, black, or green (0).')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('color')
										.setDescription('Color to bet on.')
										.setRequired(true)
										.addChoices(
											{ name: 'Red (2×)', value: 'red' },
											{ name: 'Black (2×)', value: 'black' },
											{ name: 'Green 0 (14×)', value: 'green' },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('scratch')
								.setDescription('Buy a scratch ticket.')
								.addIntegerOption((o) =>
									o
										.setName('tier')
										.setDescription('Ticket tier.')
										.setRequired(false)
										.addChoices(
											{ name: 'Bronze (100)', value: 100 },
											{ name: 'Silver (500)', value: 500 },
											{ name: 'Gold (2000)', value: 2000 },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('coinflip')
								.setDescription('Flip a coin.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('side')
										.setDescription('Heads or tails.')
										.setRequired(true)
										.addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('blackjack')
								.setDescription('Play blackjack for coins.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10)),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('quick')
						.setDescription('Fast 50/50-style games.')
						.addSubcommand((s) =>
							s
								.setName('dice')
								.setDescription('Roll 2d6 — over, under, seven, or doubles.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('mode')
										.setDescription('Bet type.')
										.setRequired(true)
										.addChoices(
											{ name: 'Over 7 (2×)', value: 'over' },
											{ name: 'Under 7 (2×)', value: 'under' },
											{ name: 'Exactly 7 (5×)', value: 'seven' },
											{ name: 'Doubles (6×)', value: 'doubles' },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('rps')
								.setDescription('Rock / paper / scissors vs the house.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('choice')
										.setDescription('Your throw.')
										.setRequired(true)
										.addChoices(
											{ name: 'Rock', value: 'rock' },
											{ name: 'Paper', value: 'paper' },
											{ name: 'Scissors', value: 'scissors' },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('war')
								.setDescription('Higher card wins.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10)),
						)
						.addSubcommand((s) =>
							s
								.setName('highlow')
								.setDescription('Guess if the next card is higher or lower.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('guess')
										.setDescription('Higher or lower.')
										.setRequired(true)
										.addChoices({ name: 'Higher', value: 'high' }, { name: 'Lower', value: 'low' }),
								),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('table')
						.setDescription('Table & race games.')
						.addSubcommand((s) =>
							s
								.setName('baccarat')
								.setDescription('Player / Banker / Tie.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('side')
										.setDescription('Who wins.')
										.setRequired(true)
										.addChoices(
											{ name: 'Player (2×)', value: 'player' },
											{ name: 'Banker (1.95×)', value: 'banker' },
											{ name: 'Tie (8×)', value: 'tie' },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('poker')
								.setDescription('5-card showdown vs the dealer.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10)),
						)
						.addSubcommand((s) =>
							s
								.setName('sicbo')
								.setDescription('Bet on 3-dice totals / small / big.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('wager')
										.setDescription('Wager type.')
										.setRequired(true)
										.addChoices(
											{ name: 'Small 4–10 (2×)', value: 'small' },
											{ name: 'Big 11–17 (2×)', value: 'big' },
											{ name: 'Triple any (30×)', value: 'triple' },
											{ name: 'Total 10 or 11 (6×)', value: 'mid' },
										),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('horse')
								.setDescription('Bet on a horse race (8 horses, ~7×).')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addIntegerOption((o) =>
									o
										.setName('horse')
										.setDescription('Horse number 1–8.')
										.setRequired(true)
										.setMinValue(1)
										.setMaxValue(8),
								),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('risk')
						.setDescription('Multiplier / board games.')
						.addSubcommand((s) =>
							s
								.setName('crash')
								.setDescription('Cash out before the rocket explodes.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addNumberOption((o) =>
									o
										.setName('target')
										.setDescription('Cash-out multiplier (e.g. 1.5).')
										.setRequired(true)
										.setMinValue(1.01)
										.setMaxValue(50),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('limbo')
								.setDescription('Instant target-multiplier bet.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addNumberOption((o) =>
									o
										.setName('target')
										.setDescription('Target multiplier.')
										.setRequired(true)
										.setMinValue(1.01)
										.setMaxValue(100),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('mines')
								.setDescription('Auto-reveal safe tiles.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addIntegerOption((o) =>
									o
										.setName('bombs')
										.setDescription('Bombs on the board (1–20).')
										.setRequired(true)
										.setMinValue(1)
										.setMaxValue(20),
								)
								.addIntegerOption((o) =>
									o
										.setName('picks')
										.setDescription('Safe tiles to reveal.')
										.setRequired(true)
										.setMinValue(1)
										.setMaxValue(20),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('tower')
								.setDescription('Climb floors — each is riskier.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addIntegerOption((o) =>
									o
										.setName('floors')
										.setDescription('How many floors to attempt (1–8).')
										.setRequired(true)
										.setMinValue(1)
										.setMaxValue(8),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('wheel')
								.setDescription('Spin the prize wheel.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10)),
						)
						.addSubcommand((s) =>
							s
								.setName('plinko')
								.setDescription('Drop a chip down the pegboard.')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o
										.setName('risk')
										.setDescription('Risk profile.')
										.setRequired(false)
										.addChoices(
											{ name: 'Low', value: 'low' },
											{ name: 'Medium', value: 'medium' },
											{ name: 'High', value: 'high' },
										),
								),
						),
				)
				.addSubcommandGroup((group) =>
					group
						.setName('tickets')
						.setDescription('Number draws.')
						.addSubcommand((s) =>
							s
								.setName('lottery')
								.setDescription('Pick 5 numbers (1–50) or quick-pick.')
								.addIntegerOption((o) =>
									o.setName('bet').setDescription('Ticket cost.').setRequired(true).setMinValue(50),
								)
								.addStringOption((o) =>
									o
										.setName('numbers')
										.setDescription('Five numbers like 1,7,12,33,48 — omit for quick pick.')
										.setRequired(false),
								),
						)
						.addSubcommand((s) =>
							s
								.setName('keno')
								.setDescription('Pick up to 8 numbers (1–40).')
								.addIntegerOption((o) => o.setName('bet').setDescription('Bet.').setRequired(true).setMinValue(10))
								.addStringOption((o) =>
									o.setName('picks').setDescription('Comma-separated numbers, e.g. 3,7,12,19').setRequired(true),
								),
						),
				),
		);
	}

	public async runHelp(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!(await guard(interaction))) return;
		const c = makeContainer({ color: Colors.Info, header: 'Casino map' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				[
					'**PvP** — `/gamble duel`',
					'**Classic** — `/gamble classic slots|roulette|scratch|coinflip|blackjack`',
					'**Quick** — `/gamble quick dice|rps|war|highlow`',
					'**Table** — `/gamble table baccarat|poker|sicbo|horse`',
					'**Risk** — `/gamble risk crash|limbo|mines|tower|wheel|plinko`',
					'**Tickets** — `/gamble tickets lottery|keno`',
					'',
					"Coins come from `/economy` · shop boosts: Gambler's Dice, Insurance…",
					`-# Max bet ${MAX_BET.toLocaleString()} ${CURRENCY}`,
				].join('\n'),
			),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// Classic + duel live on the economy command class (shared with balance dashboard).
	public async runDuel(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runDuel(interaction);
	}
	public async runSlots(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runSlots(interaction);
	}
	public async runRoulette(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runRoulette(interaction);
	}
	public async runScratch(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runScratch(interaction);
	}
	public async runCoinflip(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runCoinflip(interaction);
	}
	public async runBlackjack(interaction: Subcommand.ChatInputCommandInteraction) {
		return this.eco().runBlackjack(interaction);
	}

	public async runDice(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const mode = interaction.options.getString('mode', true);
		const a = rollDice();
		const b = rollDice();
		const sum = a + b;
		let won = false;
		let mult = 0;
		if (mode === 'over') {
			won = sum > 7;
			mult = 2;
		} else if (mode === 'under') {
			won = sum < 7;
			mult = 2;
		} else if (mode === 'seven') {
			won = sum === 7;
			mult = 5;
		} else {
			won = a === b;
			mult = 6;
		}
		const payout = won ? Math.floor(bet * mult) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'dice_win',
			'dice_loss',
			'Dice',
			`Rolled **${a}** + **${b}** = **${sum}**\nMode: \`${mode}\` — ${won ? `hit ${mult}×!` : 'miss.'}`,
		);
	}

	public async runRps(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const choice = interaction.options.getString('choice', true) as 'rock' | 'paper' | 'scissors';
		const opts = ['rock', 'paper', 'scissors'] as const;
		const house = opts[Math.floor(Math.random() * 3)]!;
		const beats: Record<string, string> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
		let payout = 0;
		let line = 'Tie — bet returned.';
		if (choice === house) {
			payout = bet;
		} else if (beats[choice] === house) {
			payout = bet * 2;
			line = 'You win!';
		} else {
			line = 'House wins.';
		}
		const emoji = { rock: '🪨', paper: '📄', scissors: '✂️' };
		return settle(
			interaction,
			bet,
			payout,
			'rps_win',
			'rps_loss',
			'Rock Paper Scissors',
			`You ${emoji[choice]} vs House ${emoji[house]}\n${line}`,
		);
	}

	public async runCrash(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const target = Math.min(50, Math.max(1.01, interaction.options.getNumber('target', true)));
		const crashed = crashPoint();
		const won = crashed >= target;
		const payout = won ? Math.floor(bet * target) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'crash_win',
			'crash_loss',
			'Crash',
			`🚀 Rocket crashed at **${crashed.toFixed(2)}×**\nYour cash-out: **${target.toFixed(2)}×** — ${won ? 'escaped!' : 'rekt.'}`,
		);
	}

	public async runHorse(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const pick = interaction.options.getInteger('horse', true) - 1;
		const { order } = raceHorses();
		const winner = order[0]!;
		const podium = order
			.slice(0, 3)
			.map((i, place) => `${place + 1}. ${HORSE_NAMES[i]} (#${i + 1})`)
			.join('\n');
		const won = pick === winner;
		const payout = won ? bet * 7 : 0;
		return settle(
			interaction,
			bet,
			payout,
			'horse_win',
			'horse_loss',
			'Horse Race',
			`You bet on **${HORSE_NAMES[pick]}** (#${pick + 1})\n${podium}\n${won ? '🏆 Photo finish — you win 7×!' : 'Lost the ticket.'}`,
		);
	}

	public async runLottery(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;

		let picks: number[];
		const raw = interaction.options.getString('numbers');
		if (raw) {
			picks = [
				...new Set(
					raw
						.split(/[,\s]+/)
						.map((x) => Number.parseInt(x, 10))
						.filter((n) => Number.isFinite(n) && n >= 1 && n <= 50),
				),
			].slice(0, 5);
			if (picks.length !== 5) {
				await walletAdd(interaction.user.id, interaction.guild!.id, bet);
				return interaction.editReply(errorReply('Provide exactly 5 unique numbers between 1–50.'));
			}
			picks.sort((a, b) => a - b);
		} else {
			picks = lotteryDraw(50, 5);
		}

		const draw = lotteryDraw(50, 5);
		const matches = lotteryMatches(picks, draw);
		const mult = LOTTERY_PAYOUT[matches] ?? 0;
		const payout = Math.floor(bet * mult);
		return settle(
			interaction,
			bet,
			payout,
			'lottery_win',
			'lottery_loss',
			'Lottery',
			`Your picks: **${picks.join(', ')}**\nDraw: **${draw.join(', ')}**\nMatches: **${matches}** → ${mult}×`,
		);
	}

	public async runMines(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const bombs = interaction.options.getInteger('bombs', true);
		const picks = interaction.options.getInteger('picks', true);
		if (picks + bombs >= 25) {
			await walletAdd(interaction.user.id, interaction.guild!.id, bet);
			return interaction.editReply(errorReply('picks + bombs must be less than 25.'));
		}

		const bombSet = generateMinesBoard(bombs);
		const cells = Array.from({ length: 25 }, (_, i) => i);
		// shuffle and take picks
		for (let i = cells.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[cells[i], cells[j]] = [cells[j]!, cells[i]!];
		}
		const chosen = cells.slice(0, picks);
		const hit = chosen.some((c) => bombSet.has(c));
		const mult = minesMultiplier(picks, bombs);
		const payout = hit ? 0 : Math.floor(bet * mult);
		return settle(
			interaction,
			bet,
			payout,
			'mines_win',
			'mines_loss',
			'Mines',
			hit
				? `💥 Hit a bomb after revealing tiles. (${bombs} bombs, ${picks} picks)`
				: `✅ Cleared **${picks}** safe tiles with **${bombs}** bombs — **${mult.toFixed(2)}×**!`,
		);
	}

	public async runWheel(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const slice = spinWheel();
		const payout = Math.floor(bet * slice.mult);
		return settle(
			interaction,
			bet,
			payout,
			'wheel_win',
			'wheel_loss',
			'Prize Wheel',
			`${slice.emoji} Landed on **${slice.label}**`,
		);
	}

	public async runHighlow(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const guess = interaction.options.getString('guess', true);
		const first = rollDice(13);
		let second = rollDice(13);
		while (second === first) second = rollDice(13);
		const won = guess === 'high' ? second > first : second < first;
		const payout = won ? Math.floor(bet * 1.9) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'highlow_win',
			'highlow_loss',
			'High / Low',
			`First card **${first}** → next **${second}**\nYou guessed **${guess}** — ${won ? 'correct!' : 'wrong.'}`,
		);
	}

	public async runBaccarat(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const side = interaction.options.getString('side', true);
		const player = baccaratHand();
		const banker = baccaratHand();
		let result: 'player' | 'banker' | 'tie' = 'tie';
		if (player.total > banker.total) result = 'player';
		else if (banker.total > player.total) result = 'banker';
		const won = side === result;
		let mult = 0;
		if (won) {
			if (side === 'player') mult = 2;
			else if (side === 'banker') mult = 1.95;
			else mult = 8;
		}
		const payout = Math.floor(bet * mult);
		return settle(
			interaction,
			bet,
			payout,
			'baccarat_win',
			'baccarat_loss',
			'Baccarat',
			`Player **${player.total}** (${player.cards.join(', ')}) vs Banker **${banker.total}** (${banker.cards.join(', ')})\nResult: **${result}** — you bet **${side}**.`,
		);
	}

	public async runPoker(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;

		const draw5 = () => Array.from({ length: 5 }, () => rollDice(13));
		const score = (hand: number[]) => {
			const counts = new Map<number, number>();
			for (const c of hand) counts.set(c, (counts.get(c) ?? 0) + 1);
			const vals = [...counts.values()].sort((a, b) => b - a);
			const high = Math.max(...hand);
			if (vals[0] === 4) return 700 + high;
			if (vals[0] === 3 && vals[1] === 2) return 600 + high;
			if (vals[0] === 3) return 500 + high;
			if (vals[0] === 2 && vals[1] === 2) return 400 + high;
			if (vals[0] === 2) return 300 + high;
			return high;
		};
		const you = draw5();
		const dealer = draw5();
		const ys = score(you);
		const ds = score(dealer);
		let payout = 0;
		let line = 'Push — bet returned.';
		if (ys > ds) {
			payout = bet * 2;
			line = 'You win the showdown!';
		} else if (ys < ds) {
			line = 'Dealer wins.';
		} else {
			payout = bet;
		}
		return settle(
			interaction,
			bet,
			payout,
			'poker_win',
			'poker_loss',
			'Poker Showdown',
			`You: **${you.join(' ')}** (score ${ys})\nDealer: **${dealer.join(' ')}** (score ${ds})\n${line}`,
		);
	}

	public async runPlinko(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const risk = interaction.options.getString('risk') ?? 'medium';
		const tables: Record<string, number[]> = {
			low: [0.5, 0.7, 0.9, 1.1, 1.2, 1.1, 0.9, 0.7, 0.5],
			medium: [0.2, 0.5, 0.8, 1.2, 2.5, 1.2, 0.8, 0.5, 0.2],
			high: [0, 0.2, 0.5, 1.5, 8, 1.5, 0.5, 0.2, 0],
		};
		const row = tables[risk] ?? tables.medium!;
		// binomial-ish path
		let slot = 0;
		for (let i = 0; i < row.length - 1; i++) {
			if (Math.random() < 0.5) slot++;
		}
		slot = Math.min(slot, row.length - 1);
		const mult = row[slot]!;
		const payout = Math.floor(bet * mult);
		const visual = row.map((m, i) => (i === slot ? `**[${m}×]**` : `${m}×`)).join(' ');
		return settle(interaction, bet, payout, 'plinko_win', 'plinko_loss', 'Plinko', `Risk: **${risk}**\n${visual}`);
	}

	public async runKeno(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const picks = [
			...new Set(
				interaction.options
					.getString('picks', true)
					.split(/[,\s]+/)
					.map((x) => Number.parseInt(x, 10))
					.filter((n) => Number.isFinite(n) && n >= 1 && n <= 40),
			),
		].slice(0, 8);
		if (picks.length < 2) {
			await walletAdd(interaction.user.id, interaction.guild!.id, bet);
			return interaction.editReply(errorReply('Pick at least 2 unique numbers (1–40).'));
		}
		const draw = lotteryDraw(40, 10);
		const hits = lotteryMatches(picks, draw);
		const payTable: Record<number, number> = { 0: 0, 1: 0, 2: 1.2, 3: 2.5, 4: 6, 5: 15, 6: 40, 7: 100, 8: 250 };
		const mult = payTable[Math.min(hits, 8)] ?? 0;
		const payout = Math.floor(bet * mult);
		return settle(
			interaction,
			bet,
			payout,
			'keno_win',
			'keno_loss',
			'Keno',
			`Picks: **${picks.join(', ')}**\nDraw: **${draw.join(', ')}**\nHits: **${hits}** → ${mult}×`,
		);
	}

	public async runLimbo(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const target = Math.min(100, Math.max(1.01, interaction.options.getNumber('target', true)));
		const result = crashPoint();
		const won = result >= target;
		const payout = won ? Math.floor(bet * target) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'limbo_win',
			'limbo_loss',
			'Limbo',
			`Result **${result.toFixed(2)}×** vs target **${target.toFixed(2)}×** — ${won ? 'hit!' : 'bust.'}`,
		);
	}

	public async runWar(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const you = rollDice(13);
		const house = rollDice(13);
		let payout = 0;
		let line = 'War! Bet returned.';
		if (you > house) {
			payout = bet * 2;
			line = 'You take the pot!';
		} else if (you < house) {
			line = 'House wins the war.';
		} else {
			payout = bet;
		}
		return settle(
			interaction,
			bet,
			payout,
			'war_win',
			'war_loss',
			'War',
			`You **${you}** vs House **${house}**\n${line}`,
		);
	}

	public async runSicbo(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const wager = interaction.options.getString('wager', true);
		const d = [rollDice(), rollDice(), rollDice()] as const;
		const sum = d[0] + d[1] + d[2];
		const triple = d[0] === d[1] && d[1] === d[2];
		let won = false;
		let mult = 0;
		if (wager === 'small') {
			won = !triple && sum >= 4 && sum <= 10;
			mult = 2;
		} else if (wager === 'big') {
			won = !triple && sum >= 11 && sum <= 17;
			mult = 2;
		} else if (wager === 'triple') {
			won = triple;
			mult = 30;
		} else {
			won = sum === 10 || sum === 11;
			mult = 6;
		}
		const payout = won ? Math.floor(bet * mult) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'sicbo_win',
			'sicbo_loss',
			'Sic Bo',
			`Dice **${d.join(' · ')}** (sum **${sum}**${triple ? ', TRIPLE' : ''})\nWager \`${wager}\` — ${won ? `${mult}×!` : 'loss.'}`,
		);
	}

	public async runTower(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await guard(interaction))) return;
		const bet = await takeBet(interaction, interaction.options.getInteger('bet', true));
		if (bet === null) return;
		const floors = interaction.options.getInteger('floors', true);
		let mult = 1;
		let climbed = 0;
		for (let f = 1; f <= floors; f++) {
			const surviveChance = 0.72 - f * 0.04;
			if (Math.random() > surviveChance) break;
			climbed = f;
			mult *= 1.35;
		}
		const won = climbed === floors;
		const payout = won ? Math.floor(bet * mult) : 0;
		return settle(
			interaction,
			bet,
			payout,
			'tower_win',
			'tower_loss',
			'Tower',
			won
				? `🗼 Climbed all **${floors}** floors — **${mult.toFixed(2)}×**!`
				: `💥 Fell on floor **${climbed + 1}** of ${floors}.`,
		);
	}
}
