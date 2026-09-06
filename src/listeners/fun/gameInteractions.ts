import { ApplyOptions } from '@sapphire/decorators';
import { Listener } from '@sapphire/framework';
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Events,
	type Interaction,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	ModalBuilder,
	TextDisplayBuilder,
	TextInputBuilder,
	TextInputStyle,
} from 'discord.js';
import { sql } from 'drizzle-orm';
import {
	build2048Components,
	buildBlackjackComponents,
	buildC4Components,
	buildFindTheEmojiComponents,
	buildHangmanComponents,
	buildNHIEComponents,
	buildRPSComponents,
	buildTTTComponents,
	buildWordleComponents,
	cardFace,
	checkC4Win,
	checkTTTWin,
	dropPiece,
	fetchAnimalImage,
	getRandomDare,
	getRandomNHIE,
	getRandomTruth,
	is2048GameOver,
	isC4Draw,
	isTTTDraw,
	render2048Board,
	slideDown,
	slideLeft,
	slideRight,
	slideUp,
	spawnTile,
} from '../../commands/fun/fun.js';
import { handTotal } from '../../lib/BlackjackUtil.js';
import { isBotBlacklisted } from '../../lib/BlacklistUtil.js';
import { Colors, CV2_FLAG, makeContainer, separator as makeSeparator } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	type C4Game,
	c4Games,
	findTheEmojiGames,
	funBlackjackGames,
	games2048,
	hangmanGames,
	isStaleInteractionError,
	type NHIEGame,
	nhieGames,
	pendingGames,
	type RPSGame,
	resolveGame,
	rpsGames,
	type TTTGame,
	triviaGames,
	tttGames,
	type WYRGame,
	wordleGames,
	wyrGames,
} from '../../lib/GameStore.js';
import { fetchJoke } from '../../lib/JokeUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

function extractItalicPrompt(message: import('discord.js').Message): string | null {
	try {
		const raw = JSON.stringify(message.components.map((c) => c.toJSON()));
		const match = raw.match(/\*([^*]+)\*/);
		return match?.[1]?.trim() || null;
	} catch {
		return null;
	}
}

function armTimeout(store: Map<string, { timeout: ReturnType<typeof setTimeout> }>, key: string, ms: number) {
	const game = store.get(key);
	if (!game) return;
	clearTimeout(game.timeout);
	game.timeout = setTimeout(() => store.delete(key), ms);
}

const COLS = 7;
const ROWS = 6;

function makeEmptyC4Board(): number[][] {
	return Array.from({ length: ROWS }, () => Array(COLS).fill(0) as number[]);
}

function makeEmptyTTTBoard(): number[] {
	return Array(9).fill(0) as number[];
}

@ApplyOptions<Listener.Options>({
	name: 'gameInteractions',
	event: Events.InteractionCreate,
})
export class GameInteractionsListener extends Listener<typeof Events.InteractionCreate> {
	public override async run(interaction: Interaction) {
		if (await isBotBlacklisted(interaction.user.id)) return;
		try {
			if (!interaction.isButton() && !interaction.isModalSubmit()) return;
			if (!interaction.customId.startsWith('game:')) return;
			if (!interaction.inCachedGuild()) return;
			if (!(await isModuleEnabled(interaction.guildId, 'fun'))) {
				if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
					await interaction.reply({
						content: '❌ The Fun & Games module is disabled on this server.',
						flags: MessageFlags.Ephemeral,
					});
				}
				return;
			}

			const parts = interaction.customId.split(':');
			const gameType = parts[1];
			const action = parts[2];
			const msgId = parts[3];
			const extra = parts[4];

			if (gameType === 'c4') {
				if (interaction.isButton()) await this.handleC4(interaction, action, msgId, extra);
			} else if (gameType === 'ttt') {
				if (interaction.isButton()) await this.handleTTT(interaction, action, msgId, extra);
			} else if (gameType === 'trivia') {
				if (interaction.isButton()) await this.handleTrivia(interaction, action, msgId, extra);
			} else if (gameType === 'rps') {
				if (interaction.isButton()) await this.handleRPS(interaction, action, msgId, extra);
			} else if (gameType === 'joke') {
				if (interaction.isButton()) await this.handleJoke(interaction, action, msgId);
			} else if (gameType === 'wyr') {
				if (interaction.isButton()) await this.handleWYR(interaction, action, msgId, extra);
			} else if (gameType === 'animal') {
				if (interaction.isButton()) await this.handleAnimal(interaction, action, msgId);
			} else if (gameType === '2048') {
				if (interaction.isButton()) await this.handle2048(interaction, action, msgId, extra);
			} else if (gameType === 'findtheemoji') {
				if (interaction.isButton()) await this.handleFindTheEmoji(interaction, action, msgId, extra);
			} else if (gameType === 'wordle') {
				await this.handleWordle(interaction, action, msgId);
			} else if (gameType === 'hangman') {
				await this.handleHangman(interaction, action, msgId);
			} else if (gameType === 'bj') {
				if (interaction.isButton()) await this.handleFunBlackjack(interaction, action, msgId);
			} else if (gameType === 'truthordare') {
				if (interaction.isButton()) await this.handleTruthordare(interaction, action, msgId);
			} else if (gameType === 'nhie') {
				if (interaction.isButton()) await this.handleNHIE(interaction, action, msgId, extra);
			} else if (gameType === 'hl') {
				if (interaction.isButton()) await this.handleHigherLower(interaction, action, parts);
			}
		} catch (err) {
			// Swallow stale interaction errors — never re-throw (AGENTS.md / Discord 10062)
			if (isStaleInteractionError(err)) return;
			throw err;
		}
	}

	// ─── Connect 4 ────────────────────────────────────────────────────────────────

	private async handleC4(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		if (action === 'accept' || action === 'decline') {
			const pending = pendingGames.get(msgId);
			if (!pending || pending.type !== 'c4') {
				return interaction.reply({ content: '❌ This challenge has expired.', flags: MessageFlags.Ephemeral });
			}

			if (interaction.user.id !== pending.targetId) {
				return interaction.reply({
					content: '❌ Only the challenged player can respond.',
					flags: MessageFlags.Ephemeral,
				});
			}

			clearTimeout(pending.timeout);
			pendingGames.delete(msgId);

			if (action === 'decline') {
				const container = makeContainer({ color: Colors.Error });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ⚔️ Connect 4 Challenge\n<@${pending.challengerId}>'s challenge was **declined** by <@${pending.targetId}>.`,
					),
				);
				return interaction.update({
					components: [container],
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Accept — start game
			const board = makeEmptyC4Board();
			const timeout = setTimeout(() => {
				const game = c4Games.get(msgId);
				if (!game) return;
				c4Games.delete(msgId);
				const container = makeContainer({ color: Colors.Neutral });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### 🎮 Connect 4\nGame between <@${game.players[0]}> and <@${game.players[1]}> has **timed out**.`,
					),
				);
				interaction.message
					.edit({
						components: [container],
						// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}, 600_000);

			const game: C4Game = {
				board,
				players: [pending.challengerId, pending.targetId],
				currentTurn: 0,
				guildId: pending.guildId,
				timeout,
			};
			c4Games.set(msgId, game);

			const { container, files } = buildC4Components(msgId, board, false, game.players, 0);
			return interaction.update({
				components: [container],
				files,
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'move') {
			const game = c4Games.get(msgId);
			if (!game) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const currentPlayerId = game.players[game.currentTurn];
			if (interaction.user.id !== currentPlayerId) {
				return interaction.reply({ content: "❌ It's not your turn!", flags: MessageFlags.Ephemeral });
			}

			const col = parseInt(extra ?? '0', 10);
			if (Number.isNaN(col) || col < 0 || col >= COLS) {
				return interaction.reply({ content: '❌ Invalid column.', flags: MessageFlags.Ephemeral });
			}

			const playerNum = game.currentTurn + 1;
			const placed = dropPiece(game.board, col, playerNum);
			if (!placed) {
				return interaction.reply({ content: '❌ That column is full! Choose another.', flags: MessageFlags.Ephemeral });
			}

			// Check win
			if (checkC4Win(game.board, playerNum)) {
				clearTimeout(game.timeout);
				c4Games.delete(msgId);

				const winnerMention = `<@${currentPlayerId}>`;
				const loserMention = `<@${game.players[game.currentTurn === 0 ? 1 : 0]}>`;
				const winPiece = game.currentTurn === 0 ? '🔵' : '🔴';

				const { container, files } = buildC4Components(
					msgId,
					game.board,
					true,
					game.players,
					game.currentTurn,
					`${winPiece} **${winnerMention} wins!**\n🎉 ${winnerMention} beat ${loserMention}!`,
				);
				return interaction.update({
					components: [container],
					files,
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Check draw
			if (isC4Draw(game.board)) {
				clearTimeout(game.timeout);
				c4Games.delete(msgId);

				const { container, files } = buildC4Components(
					msgId,
					game.board,
					true,
					game.players,
					game.currentTurn,
					`🤝 It's a draw!`,
				);
				return interaction.update({
					components: [container],
					files,
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Continue game — flip turn
			game.currentTurn = (game.currentTurn === 0 ? 1 : 0) as 0 | 1;
			const { container, files } = buildC4Components(msgId, game.board, false, game.players, game.currentTurn);
			return interaction.update({
				components: [container],
				files,
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'resign') {
			const game = c4Games.get(msgId);
			if (!game) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist.',
					flags: MessageFlags.Ephemeral,
				});
			}

			if (!game.players.includes(interaction.user.id)) {
				return interaction.reply({ content: '❌ You are not part of this game.', flags: MessageFlags.Ephemeral });
			}

			clearTimeout(game.timeout);
			c4Games.delete(msgId);

			const resignerIdx = game.players.indexOf(interaction.user.id) as 0 | 1;
			const winnerId = game.players[resignerIdx === 0 ? 1 : 0];

			const { container, files } = buildC4Components(
				msgId,
				game.board,
				true,
				game.players,
				resignerIdx,
				`🏳️ <@${interaction.user.id}> resigned. <@${winnerId}> wins!`,
			);
			return interaction.update({
				components: [container],
				files,
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				flags: CV2_FLAG as any,
			});
		}

		return null;
	}

	// ─── Tic Tac Toe ─────────────────────────────────────────────────────────────

	private async handleTTT(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		if (action === 'accept' || action === 'decline') {
			const pending = pendingGames.get(msgId);
			if (!pending || pending.type !== 'ttt') {
				return interaction.reply({ content: '❌ This challenge has expired.', flags: MessageFlags.Ephemeral });
			}

			if (interaction.user.id !== pending.targetId) {
				return interaction.reply({
					content: '❌ Only the challenged player can respond.',
					flags: MessageFlags.Ephemeral,
				});
			}

			clearTimeout(pending.timeout);
			pendingGames.delete(msgId);

			if (action === 'decline') {
				const container = makeContainer({ color: Colors.Error });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ⚔️ Tic Tac Toe Challenge\n<@${pending.challengerId}>'s challenge was **declined** by <@${pending.targetId}>.`,
					),
				);
				return interaction.update({
					components: [container],
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Accept — start game
			const board = makeEmptyTTTBoard();
			const timeout = setTimeout(() => {
				const game = tttGames.get(msgId);
				if (!game) return;
				tttGames.delete(msgId);
				const container = makeContainer({ color: Colors.Neutral });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ❌ Tic Tac Toe\nGame between <@${game.players[0]}> and <@${game.players[1]}> has **timed out**.`,
					),
				);
				interaction.message
					.edit({
						components: [container],
						// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}, 600_000);

			const game: TTTGame = {
				board,
				players: [pending.challengerId, pending.targetId],
				currentTurn: 0,
				guildId: pending.guildId,
				timeout,
			};
			tttGames.set(msgId, game);

			const card = buildTTTComponents(msgId, board, false, game.players, 0);
			return interaction.update({
				components: [card],
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'move') {
			const game = tttGames.get(msgId);
			if (!game) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const currentPlayerId = game.players[game.currentTurn];
			if (interaction.user.id !== currentPlayerId) {
				return interaction.reply({ content: "❌ It's not your turn!", flags: MessageFlags.Ephemeral });
			}

			const cellIdx = parseInt(extra ?? '0', 10);
			if (Number.isNaN(cellIdx) || cellIdx < 0 || cellIdx > 8) {
				return interaction.reply({ content: '❌ Invalid cell.', flags: MessageFlags.Ephemeral });
			}

			if (game.board[cellIdx] !== 0) {
				return interaction.reply({ content: '❌ That cell is already taken!', flags: MessageFlags.Ephemeral });
			}

			const playerNum = game.currentTurn + 1;
			game.board[cellIdx] = playerNum;

			// Check win
			if (checkTTTWin(game.board, playerNum)) {
				clearTimeout(game.timeout);
				tttGames.delete(msgId);

				const winnerMention = `<@${currentPlayerId}>`;
				const loserMention = `<@${game.players[game.currentTurn === 0 ? 1 : 0]}>`;
				const winEmoji = game.currentTurn === 0 ? '❌' : '⭕';

				const card = buildTTTComponents(
					msgId,
					game.board,
					true,
					game.players,
					game.currentTurn,
					`### ❌ Tic Tac Toe — ${winEmoji} **${winnerMention} wins!**\n<@${game.players[0]}> (❌) vs <@${game.players[1]}> (⭕)\n\n🎉 ${winnerMention} beat ${loserMention}!`,
				);
				return interaction.update({
					components: [card],
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Check draw
			if (isTTTDraw(game.board)) {
				clearTimeout(game.timeout);
				tttGames.delete(msgId);

				const card = buildTTTComponents(
					msgId,
					game.board,
					true,
					game.players,
					game.currentTurn,
					`### ❌ Tic Tac Toe\n<@${game.players[0]}> (❌) vs <@${game.players[1]}> (⭕)\n\n🤝 It's a draw!`,
				);
				return interaction.update({
					components: [card],
					// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
					flags: CV2_FLAG as any,
				});
			}

			// Continue — flip turn
			game.currentTurn = (game.currentTurn === 0 ? 1 : 0) as 0 | 1;
			const card = buildTTTComponents(msgId, game.board, false, game.players, game.currentTurn);
			return interaction.update({
				components: [card],
				// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
				flags: CV2_FLAG as any,
			});
		}

		return null;
	}

	// ─── Trivia ───────────────────────────────────────────────────────────────────

	private async handleTrivia(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		if (action !== 'answer') return null;

		const resolved = resolveGame(triviaGames, interaction.message.id, msgId);
		if (!resolved) {
			return interaction.reply({ content: '❌ This trivia game has expired.', flags: MessageFlags.Ephemeral });
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (interaction.user.id !== game.userId) {
			return interaction.reply({
				content: '❌ Only the person who started this trivia can answer.',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (game.answered) {
			return interaction.reply({
				content: '❌ This question has already been answered.',
				flags: MessageFlags.Ephemeral,
			});
		}

		const answerIdx = parseInt(extra ?? '0', 10);
		if (Number.isNaN(answerIdx) || answerIdx < 0 || answerIdx >= game.answers.length) {
			return interaction.reply({ content: '❌ Invalid answer.', flags: MessageFlags.Ephemeral });
		}

		clearTimeout(game.timeout);
		game.answered = true;
		triviaGames.delete(msgId);

		const chosen = game.answers[answerIdx];
		const isCorrect = chosen === game.correct;

		// Record score
		await db
			.insert(schema.triviaScores)
			.values({
				guildId: game.guildId,
				userId: interaction.user.id,
				wins: isCorrect ? 1 : 0,
				total: 1,
			})
			.onDuplicateKeyUpdate({
				set: {
					wins: isCorrect ? sql`${schema.triviaScores.wins} + 1` : sql`${schema.triviaScores.wins}`,
					total: sql`${schema.triviaScores.total} + 1`,
				},
			})
			.catch(() => null);
		const LABELS = ['A', 'B', 'C', 'D'];

		const container = makeContainer({ color: isCorrect ? Colors.Success : Colors.Error });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				isCorrect
					? `### ✅ Correct!\n<@${interaction.user.id}> answered correctly with **${chosen}**!`
					: `### ❌ Wrong!\n<@${interaction.user.id}> answered **${chosen}** but the correct answer was **${game.correct}**.`,
			),
		);
		container.addSeparatorComponents(makeSeparator());

		// Show all answers with correct one highlighted
		const answerLines = game.answers.map((ans, idx) => {
			const label = LABELS[idx];
			if (ans === game.correct) return `✅ **${label}: ${ans}** ← correct`;
			if (idx === answerIdx && !isCorrect) return `❌ ${label}: ${ans} ← your answer`;
			return `${label}: ${ans}`;
		});
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(answerLines.join('\n')));

		// Disable all buttons
		const disabledRow = new ActionRowBuilder<ButtonBuilder>();
		for (let i = 0; i < game.answers.length; i++) {
			disabledRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`game:trivia:answer:${msgId}:${i}`)
					.setLabel(`${LABELS[i]}: ${game.answers[i].slice(0, 80)}`)
					.setStyle(i === game.answers.indexOf(game.correct) ? ButtonStyle.Success : ButtonStyle.Secondary)
					.setDisabled(true),
			);
		}

		return interaction.update({
			components: [container],
			// biome-ignore lint/suspicious/noExplicitAny: Discord.js CV2 flag type gap
			flags: CV2_FLAG as any,
		});
	}

	private async handleRPS(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		if (action === 'move_bot') {
			const playerChoice = msgId;
			const botChoice = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];

			let resultText = '';
			let color: number = Colors.Info;
			if (playerChoice === botChoice) {
				resultText = `🤝 It's a tie! Both chose **${playerChoice}**.`;
				color = Colors.Neutral;
			} else if (
				(playerChoice === 'rock' && botChoice === 'scissors') ||
				(playerChoice === 'paper' && botChoice === 'rock') ||
				(playerChoice === 'scissors' && botChoice === 'paper')
			) {
				resultText = `🎉 **You win!** **${playerChoice}** beats **${botChoice}**.`;
				color = Colors.Success;
			} else {
				resultText = `😢 **You lose!** **${botChoice}** beats **${playerChoice}**.`;
				color = Colors.Error;
			}

			const c = makeContainer({ color });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### ✊ Rock Paper Scissors\n- <@${interaction.user.id}> chose: **${playerChoice}**\n- Erica chose: **${botChoice}**\n\n${resultText}`,
				),
			);

			return interaction.update({
				components: [c],
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'accept' || action === 'decline') {
			const pending = pendingGames.get(msgId);
			if (!pending || pending.type !== 'rps') {
				return interaction.reply({ content: '❌ This challenge has expired.', flags: MessageFlags.Ephemeral });
			}

			if (interaction.user.id !== pending.targetId) {
				return interaction.reply({
					content: '❌ Only the challenged player can respond.',
					flags: MessageFlags.Ephemeral,
				});
			}

			clearTimeout(pending.timeout);
			pendingGames.delete(msgId);

			if (action === 'decline') {
				const container = makeContainer({ color: Colors.Error });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ⚔️ Rock Paper Scissors Challenge\n<@${pending.challengerId}>'s challenge was **declined** by <@${pending.targetId}>.`,
					),
				);
				return interaction.update({
					components: [container],
					flags: CV2_FLAG as any,
				});
			}

			// Accept — start game
			const timeout = setTimeout(() => {
				const game = rpsGames.get(msgId);
				if (!game) return;
				rpsGames.delete(msgId);
				const container = makeContainer({ color: Colors.Neutral });
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ✊ Rock Paper Scissors\nGame between <@${game.players[0]}> and <@${game.players[1]}> has **timed out**.`,
					),
				);
				interaction.message
					.edit({
						components: [container],
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}, 300_000);

			const game: RPSGame = {
				players: [pending.challengerId, pending.targetId],
				choices: [null, null],
				guildId: pending.guildId,
				timeout,
			};
			rpsGames.set(msgId, game);

			const card = buildRPSComponents(msgId, game.players, game.choices);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'move') {
			const game = rpsGames.get(msgId);
			if (!game) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const playerIdx = game.players.indexOf(interaction.user.id);
			if (playerIdx === -1) {
				return interaction.reply({ content: '❌ You are not part of this game.', flags: MessageFlags.Ephemeral });
			}

			if (game.choices[playerIdx] !== null) {
				return interaction.reply({ content: '❌ You have already made your choice!', flags: MessageFlags.Ephemeral });
			}

			const choice = extra;
			if (!choice || !['rock', 'paper', 'scissors'].includes(choice)) {
				return interaction.reply({ content: '❌ Invalid move.', flags: MessageFlags.Ephemeral });
			}

			game.choices[playerIdx] = choice;

			await interaction.reply({
				content: `✅ You selected **${choice}**!`,
				flags: MessageFlags.Ephemeral,
			});

			if (game.choices[0] !== null && game.choices[1] !== null) {
				clearTimeout(game.timeout);
				rpsGames.delete(msgId);

				const p1Choice = game.choices[0];
				const p2Choice = game.choices[1];
				const p1 = `<@${game.players[0]}>`;
				const p2 = `<@${game.players[1]}>`;

				let resultText = '';
				let _color: number = Colors.Info;

				if (p1Choice === p2Choice) {
					resultText = `🤝 **It's a tie!** Both chose **${p1Choice}**.`;
					_color = Colors.Neutral;
				} else if (
					(p1Choice === 'rock' && p2Choice === 'scissors') ||
					(p1Choice === 'paper' && p2Choice === 'rock') ||
					(p1Choice === 'scissors' && p2Choice === 'paper')
				) {
					resultText = `🎉 **${p1} wins!** **${p1Choice}** beats **${p2Choice}**.`;
					_color = Colors.Success;
				} else {
					resultText = `🎉 **${p2} wins!** **${p2Choice}** beats **${p1Choice}**.`;
					_color = Colors.Success;
				}

				const card = buildRPSComponents(
					msgId,
					game.players,
					game.choices,
					true,
					`### ✊ Rock Paper Scissors\n${p1} vs ${p2}\n\n- ${p1} chose: **${p1Choice}**\n- ${p2} chose: **${p2Choice}**\n\n${resultText}`,
				);

				await interaction.message
					.edit({
						components: [card],
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			} else {
				const card = buildRPSComponents(msgId, game.players, game.choices);
				await interaction.message
					.edit({
						components: [card],
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}
		}
	}

	private async handleJoke(interaction: import('discord.js').ButtonInteraction, action: string, _msgId: string) {
		if (action !== 'next') return;

		await interaction.deferUpdate();
		const joke = await fetchJoke();

		const c = makeContainer({ color: Colors.Info, header: 'Joke' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(joke));

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('game:joke:next').setLabel('Another One! 🔄').setStyle(ButtonStyle.Secondary),
		);
		c.addActionRowComponents(row);

		return interaction.editReply({
			components: [c],
			flags: CV2_FLAG as any,
		});
	}

	private async handleWYR(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		const messageId = interaction.message.id;
		let resolved = resolveGame(wyrGames, messageId, msgId);
		if (!resolved) {
			// Full process restart wiped in-memory state — recover texts from the message
			const raw = JSON.stringify(interaction.message.components.map((c) => c.toJSON()));
			const o1 = raw.match(/🔵 \*\*Option 1\*\*: ([^\\"]+)/)?.[1]?.trim();
			const o2 = raw.match(/🔴 \*\*Option 2\*\*: ([^\\"]+)/)?.[1]?.trim();
			if (!o1 || !o2) {
				return interaction.reply({
					content: '❌ This Would You Rather poll has expired. Start a new one with `/fun wouldyourather`.',
					flags: MessageFlags.Ephemeral,
				});
			}
			const game: WYRGame = {
				option1: new Set(),
				option2: new Set(),
				option1Text: o1,
				option2Text: o2,
				timeout: setTimeout(() => wyrGames.delete(messageId), 7_200_000),
			};
			wyrGames.set(messageId, game);
			resolved = { game, key: messageId };
		}

		const { game } = resolved;
		const key = messageId;

		if (action === 'vote') {
			const option = extra; // '1' or '2'
			const userId = interaction.user.id;

			if (option === '1') {
				if (game.option1.has(userId)) {
					game.option1.delete(userId);
				} else {
					game.option1.add(userId);
					game.option2.delete(userId);
				}
			} else if (option === '2') {
				if (game.option2.has(userId)) {
					game.option2.delete(userId);
				} else {
					game.option2.add(userId);
					game.option1.delete(userId);
				}
			}

			armTimeout(wyrGames, key, 7_200_000);

			const total = game.option1.size + game.option2.size;
			const p1 = total === 0 ? 0 : Math.round((game.option1.size / total) * 100);
			const p2 = total === 0 ? 0 : Math.round((game.option2.size / total) * 100);

			const c = makeContainer({ color: Colors.Info, header: 'Would You Rather' });

			let votesText = '';
			if (total > 0) {
				votesText =
					`\n\n**Current Votes:**\n` +
					`🔵 **Option 1**: ${game.option1.size} vote${game.option1.size === 1 ? '' : 's'} (${p1}%)\n` +
					`🔴 **Option 2**: ${game.option2.size} vote${game.option2.size === 1 ? '' : 's'} (${p2}%)`;
			} else {
				votesText = `\n\nNo votes yet. Be the first to vote!`;
			}

			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`Would you rather...\n\n` +
						`🔵 **Option 1**: ${game.option1Text}\n` +
						`🔴 **Option 2**: ${game.option2Text}` +
						votesText,
				),
			);

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId(`game:wyr:vote:${key}:1`).setLabel('Option 1 🔵').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId(`game:wyr:vote:${key}:2`).setLabel('Option 2 🔴').setStyle(ButtonStyle.Primary),
			);
			c.addActionRowComponents(row);

			return interaction.update({
				components: [c],
				flags: CV2_FLAG as any,
			});
		}
	}

	private async handleAnimal(interaction: import('discord.js').ButtonInteraction, action: string, msgId: string) {
		if (action === 'next') {
			const type = msgId;
			let imageUrl: string;
			try {
				imageUrl = await fetchAnimalImage(type);
			} catch (_err) {
				return interaction.reply({
					content: '❌ Failed to fetch another cute animal image.',
					flags: MessageFlags.Ephemeral,
				});
			}

			if (!imageUrl) {
				return interaction.reply({
					content: '❌ Could not retrieve another image.',
					flags: MessageFlags.Ephemeral,
				});
			}

			const animalLabels: Record<string, string> = {
				cat: 'Cat 🐱',
				dog: 'Dog 🐶',
				fox: 'Fox 🦊',
				panda: 'Panda 🐼',
				redpanda: 'Red Panda 🏮',
				koala: 'Koala 🐨',
				bird: 'Bird 🐦',
				raccoon: 'Raccoon 🦝',
				kangaroo: 'Kangaroo 🦘',
				pikachu: 'Pikachu ⚡',
			};

			const label = animalLabels[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
			const c = makeContainer({ color: Colors.Info, header: `Cute ${label}` });

			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Here is a cute **${label}** for you!`));
			c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));

			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('View Image').setURL(imageUrl),
				new ButtonBuilder()
					.setCustomId(`game:animal:next:${type}`)
					.setLabel('Another One! 🔄')
					.setStyle(ButtonStyle.Secondary),
			);
			c.addActionRowComponents(row);

			return interaction.update({
				components: [c],
				flags: CV2_FLAG as any,
			});
		}
	}

	private async handle2048(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		const resolved = resolveGame(games2048, interaction.message.id, msgId);
		if (!resolved) {
			return interaction.reply({
				content: '❌ This game has ended or does not exist. Start a new one with `/fun games 2048`.',
				flags: MessageFlags.Ephemeral,
			});
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (interaction.user.id !== game.userId) {
			return interaction.reply({
				content: '❌ This is not your game!',
				flags: MessageFlags.Ephemeral,
			});
		}

		if (action === 'quit') {
			clearTimeout(game.timeout);
			games2048.delete(msgId);

			const card = build2048Components(
				msgId,
				game.board,
				game.score,
				true,
				`### 🎮 2048\nGame quit by player. Final score: **${game.score}**\n\n${render2048Board(game.board, game.score)}`,
			);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'move') {
			const dir = extra;
			const scoreObj = { score: game.score };
			let moveRes: { board: number[][]; changed: boolean };

			if (dir === 'left') moveRes = slideLeft(game.board, scoreObj);
			else if (dir === 'up') moveRes = slideUp(game.board, scoreObj);
			else if (dir === 'down') moveRes = slideDown(game.board, scoreObj);
			else if (dir === 'right') moveRes = slideRight(game.board, scoreObj);
			else {
				return interaction.reply({ content: '❌ Invalid move.', flags: MessageFlags.Ephemeral });
			}

			if (moveRes.changed) {
				game.board = moveRes.board;
				game.score = scoreObj.score;
				spawnTile(game.board);

				if (is2048GameOver(game.board)) {
					clearTimeout(game.timeout);
					games2048.delete(msgId);

					const card = build2048Components(
						msgId,
						game.board,
						game.score,
						true,
						`### 💀 Game Over!\nNo more moves available. Final score: **${game.score}**\n\n${render2048Board(game.board, game.score)}`,
					);
					return interaction.update({
						components: [card],
						flags: CV2_FLAG as any,
					});
				}
			}

			// Reset timeout
			clearTimeout(game.timeout);
			game.timeout = setTimeout(() => {
				games2048.delete(msgId);
				const expiredContainer = makeContainer({ color: Colors.Neutral });
				expiredContainer.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`### 🎮 2048\nGame timed out. Final score: **${game.score}**`),
				);
				interaction.message
					.edit({
						components: [expiredContainer],
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}, 300_000);

			const card = build2048Components(msgId, game.board, game.score, false);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}
	}

	private async handleFindTheEmoji(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		if (action !== 'guess') return;

		const resolved = resolveGame(findTheEmojiGames, interaction.message.id, msgId);
		if (!resolved) {
			return interaction.reply({
				content: '❌ This game has ended or does not exist. Start a new one with `/fun games findtheemoji`.',
				flags: MessageFlags.Ephemeral,
			});
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (game.wrongGuessers.has(interaction.user.id)) {
			return interaction.reply({
				content: '❌ You already guessed wrong this round — wait for the next one!',
				flags: MessageFlags.Ephemeral,
			});
		}

		const clickedIdx = parseInt(extra ?? '0', 10);
		const isWin = clickedIdx === game.oddIdx;

		if (isWin) {
			clearTimeout(game.timeout);
			findTheEmojiGames.delete(msgId);

			const wrongNote =
				game.wrongGuessers.size > 0
					? `\n${game.wrongGuessers.size} other player${game.wrongGuessers.size === 1 ? '' : 's'} guessed wrong.`
					: '';

			const card = buildFindTheEmojiComponents(
				msgId,
				game.commonEmoji,
				game.oddEmoji,
				game.oddIdx,
				true,
				`### ✅ <@${interaction.user.id}> found it!\nThe odd-one-out was **${game.oddEmoji}**.${wrongNote}`,
				clickedIdx,
			);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}

		// Wrong guess — lock this player out, keep the race open for everyone else
		game.wrongGuessers.add(interaction.user.id);
		return interaction.reply({
			content: `❌ Not that one — you're out for this round. Keep watching!`,
			flags: MessageFlags.Ephemeral,
		});
	}

	private async handleWordle(interaction: Interaction, action: string, msgId: string) {
		const messageId =
			'message' in interaction && interaction.message && 'id' in interaction.message ? interaction.message.id : msgId;
		const resolved = resolveGame(wordleGames, messageId, msgId);
		if (!resolved) {
			if (interaction.isRepliable()) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist. Start a new one with `/fun games wordle`.',
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (interaction.user.id !== game.userId) {
			if (interaction.isRepliable()) {
				return interaction.reply({
					content: '❌ This is not your game!',
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}

		if (interaction.isButton()) {
			if (action === 'quit') {
				clearTimeout(game.timeout);
				wordleGames.delete(msgId);

				const { container, files } = buildWordleComponents(
					msgId,
					game.word,
					game.guesses,
					true,
					`Game quit by player. The word was **${game.word.toUpperCase()}**.`,
				);
				return interaction.update({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
			}

			if (action === 'guess_btn') {
				const modal = new ModalBuilder().setCustomId(`game:wordle:guess_modal:${msgId}`).setTitle('Wordle Guess');

				const input = new TextInputBuilder()
					.setCustomId('guess_input')
					.setLabel('Enter a 5-letter word:')
					.setStyle(TextInputStyle.Short)
					.setMinLength(5)
					.setMaxLength(5)
					.setRequired(true);

				const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
				modal.addComponents(row);

				return interaction.showModal(modal);
			}
		}

		if (interaction.isModalSubmit()) {
			if (action === 'guess_modal') {
				const guessInput = interaction.fields.getTextInputValue('guess_input');
				const guess = guessInput.trim().toLowerCase();

				if (!/^[a-z]{5}$/.test(guess)) {
					return interaction.reply({
						content: '❌ Your guess must be exactly 5 alphabetical letters.',
						flags: MessageFlags.Ephemeral,
					});
				}

				if (game.guesses.includes(guess)) {
					return interaction.reply({
						content: '❌ You already guessed that word!',
						flags: MessageFlags.Ephemeral,
					});
				}

				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				game.guesses.push(guess);
				clearTimeout(game.timeout);

				const isWin = guess === game.word;
				const isLoss = game.guesses.length >= 6;

				if (isWin) {
					wordleGames.delete(msgId);
					const { container, files } = buildWordleComponents(
						msgId,
						game.word,
						game.guesses,
						true,
						`### 🎉 You Win!\nYou guessed the word **${game.word.toUpperCase()}** in ${game.guesses.length}/6 tries!`,
					);
					await interaction.message?.edit({
						components: [container],
						files,
						flags: CV2_FLAG as any,
					});
					return interaction.editReply({ content: 'Guess submitted.' });
				}

				if (isLoss) {
					wordleGames.delete(msgId);
					const { container, files } = buildWordleComponents(
						msgId,
						game.word,
						game.guesses,
						true,
						`### 😢 Game Over!\nYou ran out of guesses. The word was **${game.word.toUpperCase()}**.`,
					);
					await interaction.message?.edit({
						components: [container],
						files,
						flags: CV2_FLAG as any,
					});
					return interaction.editReply({ content: 'Guess submitted.' });
				}

				game.timeout = setTimeout(() => {
					wordleGames.delete(msgId);
					const expiredContainer = makeContainer({ color: Colors.Neutral });
					expiredContainer.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`### 🟩 Wordle\nGame timed out. The word was **${game.word.toUpperCase()}**.`,
						),
					);
					interaction.message
						?.edit({
							components: [expiredContainer],
							flags: CV2_FLAG as any,
						})
						.catch(() => null);
				}, 300_000);

				const { container, files } = buildWordleComponents(msgId, game.word, game.guesses, false);
				await interaction.message?.edit({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
				return interaction.editReply({ content: 'Guess submitted.' });
			}
		}
	}

	private async handleHangman(interaction: Interaction, action: string, msgId: string) {
		const messageId =
			'message' in interaction && interaction.message && 'id' in interaction.message ? interaction.message.id : msgId;
		const resolved = resolveGame(hangmanGames, messageId, msgId);
		if (!resolved) {
			if (interaction.isRepliable()) {
				return interaction.reply({
					content: '❌ This game has ended or does not exist. Start a new one with `/fun games hangman`.',
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (interaction.user.id !== game.userId) {
			if (interaction.isRepliable()) {
				return interaction.reply({
					content: '❌ This is not your game!',
					flags: MessageFlags.Ephemeral,
				});
			}
			return;
		}

		if (interaction.isButton()) {
			if (action === 'quit') {
				clearTimeout(game.timeout);
				hangmanGames.delete(msgId);

				const { container, files } = buildHangmanComponents(
					msgId,
					game.word,
					game.guesses,
					game.wrongCount,
					true,
					`Game quit by player. The word was **${game.word.toUpperCase()}**.`,
				);
				return interaction.update({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
			}

			if (action === 'guess_btn') {
				const modal = new ModalBuilder().setCustomId(`game:hangman:guess_modal:${msgId}`).setTitle('Hangman Guess');

				const input = new TextInputBuilder()
					.setCustomId('guess_input')
					.setLabel('Enter a letter or full word:')
					.setStyle(TextInputStyle.Short)
					.setMinLength(1)
					.setMaxLength(20)
					.setRequired(true);

				const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
				modal.addComponents(row);

				return interaction.showModal(modal);
			}
		}

		if (interaction.isModalSubmit()) {
			if (action === 'guess_modal') {
				const guessInput = interaction.fields.getTextInputValue('guess_input');
				const guess = guessInput.trim().toLowerCase();

				if (!/^[a-z]+$/.test(guess)) {
					return interaction.reply({
						content: '❌ Your guess must contain only alphabetical letters.',
						flags: MessageFlags.Ephemeral,
					});
				}

				clearTimeout(game.timeout);
				let displayMsg = '';

				if (guess.length === 1) {
					if (game.guesses.includes(guess)) {
						return interaction.reply({
							content: '❌ You already guessed that letter!',
							flags: MessageFlags.Ephemeral,
						});
					}

					game.guesses.push(guess);

					if (!game.word.toLowerCase().includes(guess)) {
						game.wrongCount++;
						displayMsg = `❌ **${guess.toUpperCase()}** is not in the word!`;
					} else {
						displayMsg = `✅ Correct! **${guess.toUpperCase()}** is in the word.`;
					}
				} else {
					if (guess === game.word.toLowerCase()) {
						for (const char of game.word.toLowerCase()) {
							if (!game.guesses.includes(char)) {
								game.guesses.push(char);
							}
						}
					} else {
						game.wrongCount++;
						displayMsg = `❌ Incorrect word guess: **${guess.toUpperCase()}**!`;
					}
				}

				await interaction.deferReply({ flags: MessageFlags.Ephemeral });
				const isWin = game.word.split('').every((char) => game.guesses.includes(char.toLowerCase()));
				const isLoss = game.wrongCount >= 6;

				if (isWin) {
					hangmanGames.delete(msgId);
					const { container, files } = buildHangmanComponents(
						msgId,
						game.word,
						game.guesses,
						game.wrongCount,
						true,
						`### 🎉 You Win!\nYou successfully guessed the word **${game.word.toUpperCase()}**!`,
					);
					await interaction.message?.edit({
						components: [container],
						files,
						flags: CV2_FLAG as any,
					});
					return interaction.editReply({ content: 'Guess submitted.' });
				}

				if (isLoss) {
					hangmanGames.delete(msgId);
					const { container, files } = buildHangmanComponents(
						msgId,
						game.word,
						game.guesses,
						game.wrongCount,
						true,
						`### 💀 Game Over!\nYou ran out of guesses. The word was **${game.word.toUpperCase()}**.`,
					);
					await interaction.message?.edit({
						components: [container],
						files,
						flags: CV2_FLAG as any,
					});
					return interaction.editReply({ content: 'Guess submitted.' });
				}

				game.timeout = setTimeout(() => {
					hangmanGames.delete(msgId);
					const expiredContainer = makeContainer({ color: Colors.Neutral });
					expiredContainer.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`### 💀 Hangman\nGame timed out. The word was **${game.word.toUpperCase()}**.`,
						),
					);
					interaction.message
						?.edit({
							components: [expiredContainer],
							flags: CV2_FLAG as any,
						})
						.catch(() => null);
				}, 300_000);

				const { container, files } = buildHangmanComponents(
					msgId,
					game.word,
					game.guesses,
					game.wrongCount,
					false,
					displayMsg ? displayMsg : undefined,
				);
				await interaction.message?.edit({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
				return interaction.editReply({ content: 'Guess submitted.' });
			}
		}
	}

	private async handleTruthordare(interaction: import('discord.js').ButtonInteraction, action: string, msgId: string) {
		if (interaction.user.id !== msgId) {
			return interaction.reply({
				content: '❌ Only the player who ran the command can choose!',
				flags: MessageFlags.Ephemeral,
			});
		}

		let promptText = '';
		let title = '';

		if (action === 'truth') {
			promptText = getRandomTruth();
			title = '💬 Truth';
		} else if (action === 'dare') {
			promptText = getRandomDare();
			title = '⚡ Dare';
		} else {
			return interaction.reply({ content: '❌ Invalid action.', flags: MessageFlags.Ephemeral });
		}

		const c = makeContainer({ color: Colors.Info, header: `Truth or Dare — ${title}` });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`**For <@${interaction.user.id}>:**\n\n*${promptText}*`),
		);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:truthordare:truth:${msgId}`)
				.setLabel('Truth 💬')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:truthordare:dare:${msgId}`)
				.setLabel('Dare ⚡')
				.setStyle(ButtonStyle.Primary),
		);
		c.addActionRowComponents(row);

		return interaction.update({
			components: [c],
			flags: CV2_FLAG as any,
		});
	}

	private async handleNHIE(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		msgId: string,
		extra: string | undefined,
	) {
		const messageId = interaction.message.id;
		let resolved = resolveGame(nhieGames, messageId, msgId);
		if (!resolved) {
			// Process restart / lost state — rehydrate from the visible prompt
			const prompt = extractItalicPrompt(interaction.message) ?? getRandomNHIE();
			const game: NHIEGame = {
				optionHave: new Set(),
				optionNever: new Set(),
				prompt,
				timeout: setTimeout(() => nhieGames.delete(messageId), 7_200_000),
			};
			nhieGames.set(messageId, game);
			resolved = { game, key: messageId };
		}

		const { game } = resolved;
		const key = messageId;

		if (action === 'vote') {
			const option = extra;
			const userId = interaction.user.id;

			if (option === 'have') {
				if (game.optionHave.has(userId)) {
					game.optionHave.delete(userId);
				} else {
					game.optionHave.add(userId);
					game.optionNever.delete(userId);
				}
			} else if (option === 'never') {
				if (game.optionNever.has(userId)) {
					game.optionNever.delete(userId);
				} else {
					game.optionNever.add(userId);
					game.optionHave.delete(userId);
				}
			}

			armTimeout(nhieGames, key, 7_200_000);

			const card = buildNHIEComponents(key, game.prompt, game.optionHave, game.optionNever, false);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'next') {
			game.optionHave.clear();
			game.optionNever.clear();
			game.prompt = getRandomNHIE();

			armTimeout(nhieGames, key, 7_200_000);

			const card = buildNHIEComponents(key, game.prompt, game.optionHave, game.optionNever, false);
			return interaction.update({
				components: [card],
				flags: CV2_FLAG as any,
			});
		}
	}

	private async handleFunBlackjack(interaction: import('discord.js').ButtonInteraction, action: string, msgId: string) {
		const resolved = resolveGame(funBlackjackGames, interaction.message.id, msgId);
		if (!resolved) {
			return interaction.reply({
				content: '❌ This game has ended or does not exist. Start a new one with `/fun games blackjack`.',
				flags: MessageFlags.Ephemeral,
			});
		}
		const game = resolved.game;
		msgId = resolved.key;

		if (interaction.user.id !== game.userId) {
			return interaction.reply({
				content: '❌ This is not your game!',
				flags: MessageFlags.Ephemeral,
			});
		}

		clearTimeout(game.timeout);

		const resolveDealer = () => {
			while (handTotal(game.dealerHand) < 17) {
				game.dealerHand.push(game.deck.pop()!);
			}
		};

		if (action === 'quit') {
			funBlackjackGames.delete(msgId);
			const { container, files } = buildBlackjackComponents(
				msgId,
				game.playerHand,
				game.dealerHand,
				true,
				false,
				'Game quit by player.',
			);
			return interaction.update({
				components: [container],
				files,
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'hit') {
			game.playerHand.push(game.deck.pop()!);
			const pt = handTotal(game.playerHand);

			if (pt > 21) {
				funBlackjackGames.delete(msgId);
				const { container, files } = buildBlackjackComponents(
					msgId,
					game.playerHand,
					game.dealerHand,
					true,
					false,
					`Bust at **${pt}**! You lost.`,
				);
				return interaction.update({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
			}

			if (pt === 21) {
				funBlackjackGames.delete(msgId);
				resolveDealer();
				const dt = handTotal(game.dealerHand);
				let status = '';
				if (dt > 21 || pt > dt) {
					status = `✨ You win! (You: **21** | Dealer: **${dt}**)`;
				} else if (pt === dt) {
					status = `Push at **21**.`;
				} else {
					status = `Dealer wins! (Dealer: **${dt}** | You: **21**)`;
				}

				const { container, files } = buildBlackjackComponents(
					msgId,
					game.playerHand,
					game.dealerHand,
					true,
					false,
					status,
				);
				return interaction.update({
					components: [container],
					files,
					flags: CV2_FLAG as any,
				});
			}

			game.timeout = setTimeout(() => {
				funBlackjackGames.delete(msgId);
				const expiredContainer = makeContainer({ color: Colors.Neutral });
				expiredContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Game timed out.`));
				interaction.message
					?.edit({
						components: [expiredContainer],
						flags: CV2_FLAG as any,
					})
					.catch(() => null);
			}, 300_000);

			const { container, files } = buildBlackjackComponents(msgId, game.playerHand, game.dealerHand, false, true);
			return interaction.update({
				components: [container],
				files,
				flags: CV2_FLAG as any,
			});
		}

		if (action === 'stand') {
			funBlackjackGames.delete(msgId);
			resolveDealer();

			const pt = handTotal(game.playerHand);
			const dt = handTotal(game.dealerHand);

			let status = '';
			if (dt > 21 || pt > dt) {
				status = `✨ You win! (You: **${pt}** | Dealer: **${dt}**)`;
			} else if (pt === dt) {
				status = `Push at **${pt}**.`;
			} else {
				status = `Dealer wins! (Dealer: **${dt}** | You: **${pt}**)`;
			}

			const { container, files } = buildBlackjackComponents(
				msgId,
				game.playerHand,
				game.dealerHand,
				true,
				false,
				status,
			);
			return interaction.update({
				components: [container],
				files,
				flags: CV2_FLAG as any,
			});
		}
	}

	private async handleHigherLower(
		interaction: import('discord.js').ButtonInteraction,
		action: string,
		parts: string[],
	) {
		const userId = parts[3];
		const current = Number(parts[4]);
		const next = Number(parts[5]);
		if (interaction.user.id !== userId) {
			return interaction.reply({ content: 'This isn’t your game.', flags: MessageFlags.Ephemeral });
		}
		if (![current, next].every((n) => Number.isFinite(n) && n >= 1 && n <= 13)) {
			return interaction.reply({ content: 'This round expired.', flags: MessageFlags.Ephemeral });
		}

		const won =
			(action === 'higher' && next > current) ||
			(action === 'lower' && next < current) ||
			(action === 'same' && next === current);

		const c = makeContainer({ color: won ? Colors.Success : Colors.Error, header: 'Higher or Lower' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Was **${cardFace(current)}** → **${cardFace(next)}**\nYou picked **${action}** — ${won ? 'you win!' : 'you lose.'}`,
			),
		);
		return interaction.update({ components: [c], flags: CV2_FLAG as any });
	}
}
