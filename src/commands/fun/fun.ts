import { createCanvas } from '@napi-rs/canvas';
import { ApplyOptions } from '@sapphire/decorators';
import { Subcommand } from '@sapphire/plugin-subcommands';
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	type ContainerBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags,
	TextDisplayBuilder,
} from 'discord.js';
import { desc, eq } from 'drizzle-orm';
import { type BjCard, buildDeck, drawBlackjackBoard, handTotal, shuffleDeck } from '../../lib/BlackjackUtil.js';
import { Colors, CV2_FLAG, errorReply, makeContainer, separator, successReply } from '../../lib/components.js';
import { db, schema } from '../../lib/database.js';
import {
	findTheEmojiGames,
	funBlackjackGames,
	games2048,
	hangmanGames,
	nhieGames,
	pendingGames,
	storySessions,
	triviaGames,
	wordleGames,
	wyrGames,
} from '../../lib/GameStore.js';
import { fetchJoke } from '../../lib/JokeUtil.js';
import { isModuleEnabled } from '../../lib/ModuleUtil.js';

// ── Connect 4 Helpers ────────────────────────────────────────────────────────

const _EMPTY = '⬛';
const P1 = '🔵';
const P2 = '🔴';
const COLS = 7;
const ROWS = 6;

export function drawC4BoardCanvas(board: number[][]): Buffer {
	const cellCountX = 7;
	const cellCountY = 6;
	const cellSize = 60;
	const cellSpacing = 8;
	const padding = 20;

	const width = cellCountX * cellSize + (cellCountX - 1) * cellSpacing + padding * 2;
	const height = cellCountY * cellSize + (cellCountY - 1) * cellSpacing + padding * 2;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');

	// Overall canvas background
	ctx.fillStyle = '#121213';
	ctx.fillRect(0, 0, width, height);

	// Blue plastic Connect 4 board background
	ctx.fillStyle = '#1e3a8a';
	ctx.fillRect(padding - 4, padding - 4, width - padding * 2 + 8, height - padding * 2 + 8);

	for (let r = 0; r < cellCountY; r++) {
		for (let c = 0; c < cellCountX; c++) {
			const x = padding + c * (cellSize + cellSpacing);
			const y = padding + (cellCountY - 1 - r) * (cellSize + cellSpacing); // index 0 is bottom

			const player = board[r][c];

			// Circular cutout
			const cx = x + cellSize / 2;
			const cy = y + cellSize / 2;
			const radius = 24;

			ctx.beginPath();
			ctx.arc(cx, cy, radius, 0, Math.PI * 2);
			ctx.closePath();

			if (player === 1) {
				// Blue checker
				const gradient = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, radius);
				gradient.addColorStop(0, '#60a5fa');
				gradient.addColorStop(1, '#1d4ed8');
				ctx.fillStyle = gradient;
				ctx.fill();
			} else if (player === 2) {
				// Red checker
				const gradient = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, radius);
				gradient.addColorStop(0, '#f87171');
				gradient.addColorStop(1, '#b91c1c');
				ctx.fillStyle = gradient;
				ctx.fill();
			} else {
				// Empty slot (show background dark)
				ctx.fillStyle = '#121213';
				ctx.fill();
			}
		}
	}

	return canvas.toBuffer('image/png');
}

export function dropPiece(board: number[][], col: number, player: number): boolean {
	for (let r = 0; r < ROWS; r++) {
		if (board[r][col] === 0) {
			board[r][col] = player;
			return true;
		}
	}
	return false;
}

export function checkC4Win(board: number[][], player: number): boolean {
	// Horizontal
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c <= COLS - 4; c++) {
			if (
				board[r][c] === player &&
				board[r][c + 1] === player &&
				board[r][c + 2] === player &&
				board[r][c + 3] === player
			)
				return true;
		}
	}
	// Vertical
	for (let r = 0; r <= ROWS - 4; r++) {
		for (let c = 0; c < COLS; c++) {
			if (
				board[r][c] === player &&
				board[r + 1][c] === player &&
				board[r + 2][c] === player &&
				board[r + 3][c] === player
			)
				return true;
		}
	}
	// Diagonal up-right
	for (let r = 0; r <= ROWS - 4; r++) {
		for (let c = 0; c <= COLS - 4; c++) {
			if (
				board[r][c] === player &&
				board[r + 1][c + 1] === player &&
				board[r + 2][c + 2] === player &&
				board[r + 3][c + 3] === player
			)
				return true;
		}
	}
	// Diagonal up-left
	for (let r = 0; r <= ROWS - 4; r++) {
		for (let c = 3; c < COLS; c++) {
			if (
				board[r][c] === player &&
				board[r + 1][c - 1] === player &&
				board[r + 2][c - 2] === player &&
				board[r + 3][c - 3] === player
			)
				return true;
		}
	}
	return false;
}

export function isC4Draw(board: number[][]): boolean {
	return board[ROWS - 1].every((cell) => cell !== 0);
}

export function buildC4Components(
	gameId: string,
	board: number[][],
	disabled: boolean,
	players: [string, string],
	currentTurn: 0 | 1,
	statusText?: string,
): { container: ContainerBuilder; files: AttachmentBuilder[] } {
	const c = makeContainer({ color: Colors.Info, header: 'Connect 4' });

	const p1 = `<@${players[0]}>`;
	const p2 = `<@${players[1]}>`;
	const currentMention = `<@${players[currentTurn]}>`;
	const currentPiece = currentTurn === 0 ? P1 : P2;

	const headerText = statusText
		? statusText
		: `${p1} (🔵) vs ${p2} (🔴)\n\n**${currentMention}'s turn** (${currentPiece})`;

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
	c.addSeparatorComponents(separator());

	// Generate board image
	const boardBuffer = drawC4BoardCanvas(board);
	const attachmentName = `c4-${gameId}-${board.flat().filter(Boolean).length}.png`;
	const file = new AttachmentBuilder(boardBuffer, { name: attachmentName });

	c.addMediaGalleryComponents(
		new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)),
	);

	if (!disabled) {
		const row1 = new ActionRowBuilder<ButtonBuilder>();
		for (let col = 0; col < 5; col++) {
			const topFull = board[ROWS - 1][col] !== 0;
			row1.addComponents(
				new ButtonBuilder()
					.setCustomId(`game:c4:move:${gameId}:${col}`)
					.setLabel(`${col + 1}`)
					.setStyle(ButtonStyle.Primary)
					.setDisabled(topFull),
			);
		}
		c.addActionRowComponents(row1);

		const row2 = new ActionRowBuilder<ButtonBuilder>();
		for (let col = 5; col < 7; col++) {
			const topFull = board[ROWS - 1][col] !== 0;
			row2.addComponents(
				new ButtonBuilder()
					.setCustomId(`game:c4:move:${gameId}:${col}`)
					.setLabel(`${col + 1}`)
					.setStyle(ButtonStyle.Primary)
					.setDisabled(topFull),
			);
		}
		row2.addComponents(
			new ButtonBuilder().setCustomId(`game:c4:resign:${gameId}`).setLabel('Resign').setStyle(ButtonStyle.Danger),
		);
		c.addActionRowComponents(row2);
	}

	return { container: c, files: [file] };
}

// ── Tic Tac Toe Helpers ──────────────────────────────────────────────────────

const EMPTY_CELL = '⬜';
const P1_CELL = '❌';
const P2_CELL = '⭕';

const WIN_LINES = [
	[0, 1, 2],
	[3, 4, 5],
	[6, 7, 8],
	[0, 3, 6],
	[1, 4, 7],
	[2, 5, 8],
	[0, 4, 8],
	[2, 4, 6],
];

export function checkTTTWin(board: number[], player: number): boolean {
	return WIN_LINES.some(([a, b, c]) => board[a] === player && board[b] === player && board[c] === player);
}

export function isTTTDraw(board: number[]): boolean {
	return board.every((cell) => cell !== 0);
}

export function buildTTTComponents(
	gameId: string,
	board: number[],
	disabled: boolean,
	players: [string, string],
	currentTurn: 0 | 1,
	statusText?: string,
): ContainerBuilder {
	const c = makeContainer({ color: Colors.Info });

	const p1 = `<@${players[0]}>`;
	const p2 = `<@${players[1]}>`;
	const currentMention = `<@${players[currentTurn]}>`;

	const headerText = statusText
		? statusText
		: `### ❌ Tic Tac Toe — ❌ vs ⭕\n${p1} (❌) vs ${p2} (⭕)\n\n**${currentMention}'s turn**`;

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
	c.addSeparatorComponents(separator());

	for (let row = 0; row < 3; row++) {
		const actionRow = new ActionRowBuilder<ButtonBuilder>();
		for (let col = 0; col < 3; col++) {
			const idx = row * 3 + col;
			const cell = board[idx];
			const cellDisabled = disabled || cell !== 0;

			let label: string;
			let style: ButtonStyle;
			if (cell === 1) {
				label = P1_CELL;
				style = ButtonStyle.Danger;
			} else if (cell === 2) {
				label = P2_CELL;
				style = ButtonStyle.Primary;
			} else {
				label = EMPTY_CELL;
				style = ButtonStyle.Secondary;
			}

			actionRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`game:ttt:move:${gameId}:${idx}`)
					.setLabel(label)
					.setStyle(style)
					.setDisabled(cellDisabled),
			);
		}
		c.addActionRowComponents(actionRow);
	}

	return c;
}

// ── Rock Paper Scissors Helpers ──────────────────────────────────────────────

export function buildRPSComponents(
	gameId: string,
	players: [string, string],
	choices: [string | null, string | null],
	finished = false,
	resultText = '',
): ContainerBuilder {
	const c = makeContainer({ color: Colors.Info });
	const p1 = `<@${players[0]}>`;
	const p2 = `<@${players[1]}>`;

	const status = finished
		? resultText
		: `### ✊ Rock Paper Scissors\n${p1} vs ${p2}\n\nWaiting for choices...\n- ${p1}: ${choices[0] ? '✅ Ready!' : '⏱️ Thinking...'}\n- ${p2}: ${choices[1] ? '✅ Ready!' : '⏱️ Thinking...'}`;

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(status));
	c.addSeparatorComponents(separator());

	if (!finished) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:rps:move:${gameId}:rock`).setLabel('Rock ✊').setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:rps:move:${gameId}:paper`)
				.setLabel('Paper ✋')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:rps:move:${gameId}:scissors`)
				.setLabel('Scissors ✌️')
				.setStyle(ButtonStyle.Primary),
		);
		c.addActionRowComponents(row);
	}
	return c;
}

// ── Trivia Types ─────────────────────────────────────────────────────────────

interface TriviaResponse {
	response_code: number;
	results: Array<{
		category: string;
		type: string;
		difficulty: string;
		question: string;
		correct_answer: string;
		incorrect_answers: string[];
	}>;
}

// ── Roleplay Setup ───────────────────────────────────────────────────────────

const RP_ACTIONS = {
	hug: { emoji: '🤗', verb: 'hugged', api: 'hug' },
	kiss: { emoji: '💋', verb: 'kissed', api: 'kiss' },
	pat: { emoji: '👋', verb: 'patted', api: 'pat' },
	slap: { emoji: '👋', verb: 'slapped', api: 'slap' },
	cuddle: { emoji: '🥰', verb: 'cuddled with', api: 'cuddle' },
	poke: { emoji: '👉', verb: 'poked', api: 'poke' },
	wave: { emoji: '👋', verb: 'waved at', api: 'wave' },
	bite: { emoji: '😬', verb: 'bit', api: 'bite' },
	cry: { emoji: '😢', verb: 'is crying', api: 'cry' },
	dance: { emoji: '💃', verb: 'is dancing', api: 'dance' },
	laugh: { emoji: '😂', verb: 'is laughing at', api: 'laugh' },
} as const;

type RpActionKey = keyof typeof RP_ACTIONS;

const SELF_ACTIONS: RpActionKey[] = ['cry', 'dance'];
const OPTIONAL_TARGET_ACTIONS: RpActionKey[] = ['laugh'];

interface NekosResult {
	results: Array<{ url: string }>;
}

// ── 2048 Game Helpers ────────────────────────────────────────────────────────

export function render2048Board(board: number[][], score: number): string {
	let out = '```\n';
	out += '┌──────┬──────┬──────┬──────┐\n';
	for (let r = 0; r < 4; r++) {
		out += '│';
		for (let c = 0; c < 4; c++) {
			const val = board[r][c];
			const valStr = val === 0 ? '' : String(val);
			const padLeft = Math.floor((6 - valStr.length) / 2);
			const padRight = 6 - valStr.length - padLeft;
			out += `${' '.repeat(padLeft) + valStr + ' '.repeat(padRight)}│`;
		}
		out += '\n';
		if (r < 3) {
			out += '├──────┼──────┼──────┼──────┤\n';
		}
	}
	out += '└──────┴──────┴──────┴──────┘\n';
	out += `Score: ${score}\n\`\`\``;
	return out;
}

export function init2048Board(): number[][] {
	const board = Array.from({ length: 4 }, () => Array(4).fill(0) as number[]);
	spawnTile(board);
	spawnTile(board);
	return board;
}

export function spawnTile(board: number[][]) {
	const empties: Array<{ r: number; c: number }> = [];
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 4; c++) {
			if (board[r][c] === 0) {
				empties.push({ r, c });
			}
		}
	}
	if (empties.length > 0) {
		const { r, c } = empties[Math.floor(Math.random() * empties.length)];
		board[r][c] = Math.random() < 0.9 ? 2 : 4;
	}
}

export function is2048GameOver(board: number[][]): boolean {
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 4; c++) {
			if (board[r][c] === 0) return false;
		}
	}
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 3; c++) {
			if (board[r][c] === board[r][c + 1]) return false;
		}
	}
	for (let r = 0; r < 3; r++) {
		for (let c = 0; c < 4; c++) {
			if (board[r][c] === board[r + 1][c]) return false;
		}
	}
	return true;
}

function slideRowLeft(row: number[], scoreObj: { score: number }): { row: number[]; changed: boolean } {
	const nonZeros = row.filter((x) => x !== 0);
	const newRow: number[] = [];
	let changed = false;
	for (let i = 0; i < nonZeros.length; i++) {
		if (i + 1 < nonZeros.length && nonZeros[i] === nonZeros[i + 1]) {
			newRow.push(nonZeros[i] * 2);
			scoreObj.score += nonZeros[i] * 2;
			i++;
			changed = true;
		} else {
			newRow.push(nonZeros[i]);
		}
	}
	while (newRow.length < 4) {
		newRow.push(0);
	}
	if (row.some((val, idx) => val !== newRow[idx])) {
		changed = true;
	}
	return { row: newRow, changed };
}

function transpose(board: number[][]): number[][] {
	const next = Array.from({ length: 4 }, () => Array(4).fill(0) as number[]);
	for (let r = 0; r < 4; r++) {
		for (let c = 0; c < 4; c++) {
			next[c][r] = board[r][c];
		}
	}
	return next;
}

export function slideLeft(board: number[][], scoreObj: { score: number }): { board: number[][]; changed: boolean } {
	const next: number[][] = [];
	let anyChanged = false;
	for (let r = 0; r < 4; r++) {
		const { row, changed } = slideRowLeft(board[r], scoreObj);
		next.push(row);
		if (changed) anyChanged = true;
	}
	return { board: next, changed: anyChanged };
}

export function slideRight(board: number[][], scoreObj: { score: number }): { board: number[][]; changed: boolean } {
	const reversed = board.map((row) => [...row].reverse());
	const { board: next, changed } = slideLeft(reversed, scoreObj);
	const finalBoard = next.map((row) => row.reverse());
	return { board: finalBoard, changed };
}

export function slideUp(board: number[][], scoreObj: { score: number }): { board: number[][]; changed: boolean } {
	const transposed = transpose(board);
	const { board: next, changed } = slideLeft(transposed, scoreObj);
	const finalBoard = transpose(next);
	return { board: finalBoard, changed };
}

export function slideDown(board: number[][], scoreObj: { score: number }): { board: number[][]; changed: boolean } {
	const transposed = transpose(board);
	const reversed = transposed.map((row) => [...row].reverse());
	const { board: next, changed } = slideLeft(reversed, scoreObj);
	const unreversed = next.map((row) => row.reverse());
	const finalBoard = transpose(unreversed);
	return { board: finalBoard, changed };
}

export function build2048Components(
	gameId: string,
	board: number[][],
	score: number,
	disabled: boolean,
	statusText?: string,
): ContainerBuilder {
	const c = makeContainer({ color: Colors.Info, header: '2048' });
	const text = statusText
		? statusText
		: `Use the buttons below to slide and merge the tiles!\n\n${render2048Board(board, score)}`;
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
	c.addSeparatorComponents(separator());

	if (!disabled) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:2048:move:${gameId}:left`).setEmoji('⬅️').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:2048:move:${gameId}:up`).setEmoji('⬆️').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:2048:move:${gameId}:down`).setEmoji('⬇️').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:2048:move:${gameId}:right`).setEmoji('➡️').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:2048:quit:${gameId}`).setLabel('Quit').setStyle(ButtonStyle.Danger),
		);
		c.addActionRowComponents(row);
	}
	return c;
}

// ── Minesweeper Game Helpers ───────────────────────────────────────────────────

export function generateMinesweeperBoard(rows: number, cols: number, mineCount: number): string {
	const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill('0️⃣') as string[]);

	let placed = 0;
	while (placed < mineCount) {
		const r = Math.floor(Math.random() * rows);
		const c = Math.floor(Math.random() * cols);
		if (grid[r][c] !== '💣') {
			grid[r][c] = '💣';
			placed++;
		}
	}

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			if (grid[r][c] === '💣') continue;

			let count = 0;
			for (let dr = -1; dr <= 1; dr++) {
				for (let dc = -1; dc <= 1; dc++) {
					const nr = r + dr;
					const nc = c + dc;
					if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
						if (grid[nr][nc] === '💣') {
							count++;
						}
					}
				}
			}

			const digitEmojis = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
			grid[r][c] = digitEmojis[count];
		}
	}

	return grid.map((row) => row.map((cell) => `||${cell}||`).join('')).join('\n');
}

// ── Find the Emoji Game Helpers ────────────────────────────────────────────────

export const EMOJI_PAIRS = [
	{ common: '🍎', odd: '🍏' },
	{ common: '🍊', odd: '🍋' },
	{ common: '🍉', odd: '🍒' },
	{ common: '🐱', odd: '🐯' },
	{ common: '🐶', odd: '🐺' },
	{ common: '🐼', odd: '🐻' },
	{ common: '🐏', odd: '🐑' },
	{ common: '🐦', odd: '🐧' },
	{ common: '🐸', odd: '🐢' },
	{ common: '🐝', odd: '🐛' },
	{ common: '🌹', odd: '🌷' },
	{ common: '⚽', odd: '🏀' },
	{ common: '🚗', odd: '🏎️' },
	{ common: '❤️', odd: '💔' },
	{ common: '😀', odd: '😃' },
	{ common: '😎', odd: '🤓' },
	{ common: '🔥', odd: '💥' },
	{ common: '⭐', odd: '🌟' },
	{ common: '🍩', odd: '🍪' },
	{ common: '🍕', odd: '🍔' },
];

export function buildFindTheEmojiComponents(
	gameId: string,
	commonEmoji: string,
	oddEmoji: string,
	oddIdx: number,
	disabled: boolean,
	statusText?: string,
	clickedIdx?: number,
): ContainerBuilder {
	const c = makeContainer({ color: Colors.Info, header: 'Find the Emoji' });
	const text = statusText
		? statusText
		: '### 🔍 Find the Emoji\n**Race!** Anyone can play — first to tap the odd-one-out wins.';
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
	c.addSeparatorComponents(separator());

	for (let row = 0; row < 3; row++) {
		const actionRow = new ActionRowBuilder<ButtonBuilder>();
		for (let col = 0; col < 3; col++) {
			const idx = row * 3 + col;
			const isOdd = idx === oddIdx;
			const emoji = isOdd ? oddEmoji : commonEmoji;

			const btn = new ButtonBuilder()
				.setCustomId(`game:findtheemoji:guess:${gameId}:${idx}`)
				.setEmoji(emoji)
				.setDisabled(disabled);

			if (disabled) {
				if (isOdd) {
					btn.setStyle(ButtonStyle.Success);
				} else if (clickedIdx !== undefined && idx === clickedIdx) {
					btn.setStyle(ButtonStyle.Danger);
				} else {
					btn.setStyle(ButtonStyle.Secondary);
				}
			} else {
				btn.setStyle(ButtonStyle.Primary);
			}

			actionRow.addComponents(btn);
		}
		c.addActionRowComponents(actionRow);
	}

	return c;
}

// ── Wordle Game Helpers ────────────────────────────────────────────────────────

export const WORDLE_WORDS = [
	'react',
	'guild',
	'botty',
	'stone',
	'cloud',
	'water',
	'flame',
	'earth',
	'grass',
	'plant',
	'music',
	'pixel',
	'coder',
	'dwarf',
	'magic',
	'sword',
	'shield',
	'armor',
	'quest',
	'fight',
	'drake',
	'slime',
	'demon',
	'angel',
	'ghost',
	'witch',
	'crypt',
	'grave',
	'tomb',
	'ruins',
	'house',
	'train',
	'paper',
	'light',
	'sound',
	'space',
	'night',
	'stars',
	'ocean',
	'beach',
	'storm',
	'windy',
	'snowy',
	'frost',
	'blaze',
	'ember',
	'shard',
	'relic',
	'toxic',
	'venom',
];

export function getWordleEmojis(guess: string, target: string): string {
	const result = ['⬛', '⬛', '⬛', '⬛', '⬛'];
	const targetChars = target.split('');
	const guessChars = guess.split('');

	for (let i = 0; i < 5; i++) {
		if (guessChars[i] === targetChars[i]) {
			result[i] = '🟩';
			targetChars[i] = '';
			guessChars[i] = '_';
		}
	}

	for (let i = 0; i < 5; i++) {
		if (guessChars[i] === '_') continue;
		const idx = targetChars.indexOf(guessChars[i]);
		if (idx !== -1) {
			result[i] = '🟨';
			targetChars[idx] = '';
		}
	}

	return result.join(' ');
}

export function drawWordleBoard(word: string, guesses: string[]): Buffer {
	const cellCountX = 5;
	const cellCountY = 6;
	const cellSize = 60;
	const cellSpacing = 8;
	const padding = 20;

	const width = cellCountX * cellSize + (cellCountX - 1) * cellSpacing + padding * 2;
	const height = cellCountY * cellSize + (cellCountY - 1) * cellSpacing + padding * 2;

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');

	// Background
	ctx.fillStyle = '#121213';
	ctx.fillRect(0, 0, width, height);

	// Font options
	ctx.font = 'bold 30px sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';

	for (let r = 0; r < cellCountY; r++) {
		const guess = guesses[r];
		const hasGuess = r < guesses.length;

		// Calculate character evaluations if we have a guess
		let feedback: string[] = [];
		if (hasGuess) {
			feedback = Array(5).fill('gray');
			const targetChars = word.split('');
			const guessChars = guess.split('');

			for (let i = 0; i < 5; i++) {
				if (guessChars[i] === targetChars[i]) {
					feedback[i] = 'green';
					targetChars[i] = '';
					guessChars[i] = '_';
				}
			}

			for (let i = 0; i < 5; i++) {
				if (guessChars[i] === '_') continue;
				const idx = targetChars.indexOf(guessChars[i]);
				if (idx !== -1) {
					feedback[i] = 'yellow';
					targetChars[idx] = '';
				}
			}
		}

		for (let c = 0; c < cellCountX; c++) {
			const x = padding + c * (cellSize + cellSpacing);
			const y = padding + r * (cellSize + cellSpacing);

			if (hasGuess) {
				const char = guess[c].toUpperCase();
				const status = feedback[c];

				if (status === 'green') {
					ctx.fillStyle = '#538d4e';
				} else if (status === 'yellow') {
					ctx.fillStyle = '#b59f3b';
				} else {
					ctx.fillStyle = '#3a3a3c';
				}

				// Draw filled cell
				ctx.fillRect(x, y, cellSize, cellSize);

				// Draw letter
				ctx.fillStyle = '#ffffff';
				ctx.fillText(char, x + cellSize / 2, y + cellSize / 2 + 2);
			} else {
				// Empty cell: draw border
				ctx.strokeStyle = '#3a3a3c';
				ctx.lineWidth = 2;
				ctx.strokeRect(x, y, cellSize, cellSize);
			}
		}
	}

	return canvas.toBuffer('image/png');
}

export function buildWordleComponents(
	gameId: string,
	word: string,
	guesses: string[],
	disabled: boolean,
	statusText?: string,
): { container: ContainerBuilder; files: AttachmentBuilder[] } {
	const c = makeContainer({ color: Colors.Info, header: 'Wordle' });
	const text = statusText ? statusText : 'Guess the 5-letter word in 6 tries!';
	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
	c.addSeparatorComponents(separator());

	// Generate board image
	const boardBuffer = drawWordleBoard(word, guesses);
	const attachmentName = `wordle-${gameId}-${guesses.length}.png`;
	const file = new AttachmentBuilder(boardBuffer, { name: attachmentName });

	c.addMediaGalleryComponents(
		new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)),
	);

	if (!disabled) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:wordle:guess_btn:${gameId}`)
				.setLabel('Guess 🔠')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:wordle:quit:${gameId}`).setLabel('Quit').setStyle(ButtonStyle.Danger),
		);
		c.addActionRowComponents(row);
	}

	return { container: c, files: [file] };
}

// ── Hangman Game Helpers ───────────────────────────────────────────────────────

export const HANGMAN_WORDS = [
	'discord',
	'drizzle',
	'sapphire',
	'typescript',
	'javascript',
	'antigravity',
	'bot',
	'gaming',
	'minecraft',
	'pokemon',
	'pikachu',
	'developer',
	'software',
	'programming',
	'database',
	'server',
	'chocolate',
	'adventure',
	'fantasy',
	'monster',
	'victory',
	'challenge',
	'keyboard',
	'computer',
];

export const HANGMAN_STAGES = [
	`  +---+
  |   |
      |
      |
      |
      |
=========`,
	`  +---+
  |   |
  O   |
      |
      |
      |
=========`,
	`  +---+
  |   |
  O   |
  |   |
      |
      |
=========`,
	`  +---+
  |   |
  O   |
 /|   |
      |
      |
=========`,
	`  +---+
  |   |
  O   |
 /|\\  |
      |
      |
=========`,
	`  +---+
  |   |
  O   |
 /|\\  |
 /    |
      |
=========`,
	`  +---+
  |   |
  O   |
 /|\\  |
 / \\  |
      |
=========`,
];

export function getHangmanMaskedWord(word: string, guesses: string[]): string {
	return word
		.split('')
		.map((letter) => (guesses.includes(letter.toLowerCase()) ? letter.toUpperCase() : '_'))
		.join(' ');
}

export function drawHangmanBoardCanvas(_word: string, _guesses: string[], wrongCount: number): Buffer {
	const canvas = createCanvas(300, 300);
	const ctx = canvas.getContext('2d');

	// Background
	ctx.fillStyle = '#121213';
	ctx.fillRect(0, 0, 300, 300);

	// Gallows styling
	ctx.strokeStyle = '#854d0e'; // Brown wood
	ctx.lineWidth = 8;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';

	// Base
	ctx.beginPath();
	ctx.moveTo(50, 260);
	ctx.lineTo(150, 260);
	ctx.stroke();

	// Upright Pole
	ctx.beginPath();
	ctx.moveTo(100, 260);
	ctx.lineTo(100, 50);
	ctx.stroke();

	// Top Beam
	ctx.beginPath();
	ctx.moveTo(100, 50);
	ctx.lineTo(200, 50);
	ctx.stroke();

	// Support Strut
	ctx.beginPath();
	ctx.moveTo(100, 90);
	ctx.lineTo(140, 50);
	ctx.stroke();

	// Rope
	ctx.strokeStyle = '#d97706'; // Rope amber
	ctx.lineWidth = 4;
	ctx.beginPath();
	ctx.moveTo(200, 50);
	ctx.lineTo(200, 90);
	ctx.stroke();

	// Stick Figure styling
	ctx.strokeStyle = '#ffffff'; // White stick figure
	ctx.lineWidth = 4;

	if (wrongCount >= 1) {
		// Head
		ctx.beginPath();
		ctx.arc(200, 110, 18, 0, Math.PI * 2);
		ctx.stroke();
	}

	if (wrongCount >= 2) {
		// Spine
		ctx.beginPath();
		ctx.moveTo(200, 128);
		ctx.lineTo(200, 190);
		ctx.stroke();
	}

	if (wrongCount >= 3) {
		// Left Arm
		ctx.beginPath();
		ctx.moveTo(200, 140);
		ctx.lineTo(165, 165);
		ctx.stroke();
	}

	if (wrongCount >= 4) {
		// Right Arm
		ctx.beginPath();
		ctx.moveTo(200, 140);
		ctx.lineTo(235, 165);
		ctx.stroke();
	}

	if (wrongCount >= 5) {
		// Left Leg
		ctx.beginPath();
		ctx.moveTo(200, 190);
		ctx.lineTo(170, 240);
		ctx.stroke();
	}

	if (wrongCount >= 6) {
		// Right Leg
		ctx.beginPath();
		ctx.moveTo(200, 190);
		ctx.lineTo(230, 240);
		ctx.stroke();

		// Dead Face: draw small Xs for eyes
		ctx.strokeStyle = '#f87171'; // Red X eyes
		ctx.lineWidth = 2;
		// Left eye X
		ctx.beginPath();
		ctx.moveTo(191, 106);
		ctx.lineTo(195, 110);
		ctx.moveTo(195, 106);
		ctx.lineTo(191, 110);
		ctx.stroke();
		// Right eye X
		ctx.beginPath();
		ctx.moveTo(205, 106);
		ctx.lineTo(209, 110);
		ctx.moveTo(209, 106);
		ctx.lineTo(205, 110);
		ctx.stroke();

		// Frown
		ctx.beginPath();
		ctx.arc(200, 122, 6, Math.PI, 0, false);
		ctx.stroke();
	}

	return canvas.toBuffer('image/png');
}

export function buildHangmanComponents(
	gameId: string,
	word: string,
	guesses: string[],
	wrongCount: number,
	disabled: boolean,
	statusText?: string,
): { container: ContainerBuilder; files: AttachmentBuilder[] } {
	const c = makeContainer({ color: Colors.Info, header: 'Hangman' });

	const masked = getHangmanMaskedWord(word, guesses);
	const guessedLetters = guesses.length > 0 ? guesses.map((g) => g.toUpperCase()).join(', ') : 'None';

	const text = statusText
		? statusText
		: `Guess the letters to reveal the word before the gallows is complete!\n\n**Word:** \`${masked}\`\n**Guessed:** ${guessedLetters}`;

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
	c.addSeparatorComponents(separator());

	// Generate board image
	const boardBuffer = drawHangmanBoardCanvas(word, guesses, wrongCount);
	const attachmentName = `hangman-${gameId}-${wrongCount}.png`;
	const file = new AttachmentBuilder(boardBuffer, { name: attachmentName });

	c.addMediaGalleryComponents(
		new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)),
	);

	if (!disabled) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:hangman:guess_btn:${gameId}`)
				.setLabel('Guess 🔠')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:hangman:quit:${gameId}`).setLabel('Quit').setStyle(ButtonStyle.Danger),
		);
		c.addActionRowComponents(row);
	}

	return { container: c, files: [file] };
}

// ── Blackjack Game Helpers ─────────────────────────────────────────────────────

export function buildBlackjackComponents(
	gameId: string,
	player: BjCard[],
	dealer: BjCard[],
	disabled: boolean,
	hideDealer: boolean,
	statusText?: string,
): { container: ContainerBuilder; files: AttachmentBuilder[] } {
	const c = makeContainer({ color: Colors.Info, header: 'Blackjack' });

	const text = statusText ? statusText : 'Play blackjack for fun!';

	c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
	c.addSeparatorComponents(separator());

	// Generate board image
	const boardBuffer = drawBlackjackBoard(player, dealer, hideDealer);
	const attachmentName = `bj-${gameId}-${player.length}-${dealer.length}.png`;
	const file = new AttachmentBuilder(boardBuffer, { name: attachmentName });

	c.addMediaGalleryComponents(
		new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`)),
	);

	if (!disabled) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:bj:hit:${gameId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:bj:stand:${gameId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
			new ButtonBuilder().setCustomId(`game:bj:quit:${gameId}`).setLabel('Quit').setStyle(ButtonStyle.Danger),
		);
		c.addActionRowComponents(row);
	}

	return { container: c, files: [file] };
}

// ── Never Have I Ever Game Helpers ─────────────────────────────────────────────

export const NHIE_PROMPTS = [
	'Never have I ever lied about my age.',
	'Never have I ever fallen asleep in class or at work.',
	'Never have I ever broken a bone.',
	'Never have I ever cried during a movie.',
	'Never have I ever sent a message to the wrong person.',
	'Never have I ever eaten food that fell on the floor.',
	'Never have I ever sung in the shower.',
	'Never have I ever gotten a speeding ticket.',
	'Never have I ever stayed awake for 24 hours straight.',
	'Never have I ever pretended to be sick to stay home.',
	'Never have I ever snuck out of the house.',
	'Never have I ever gone to a concert.',
	"Never have I ever laughed at a joke I didn't get.",
	"Never have I ever forgotten someone's name right after meeting them.",
	'Never have I ever re-gifted a present.',
];

export function getRandomNHIE(): string {
	return NHIE_PROMPTS[Math.floor(Math.random() * NHIE_PROMPTS.length)];
}

export function buildNHIEComponents(
	gameId: string,
	prompt: string,
	optionHave: Set<string>,
	optionNever: Set<string>,
	disabled: boolean,
): ContainerBuilder {
	const c = makeContainer({ color: Colors.Info, header: 'Never Have I Ever' });
	const total = optionHave.size + optionNever.size;
	const pHave = total === 0 ? 0 : Math.round((optionHave.size / total) * 100);
	const pNever = total === 0 ? 0 : Math.round((optionNever.size / total) * 100);

	let votesText = '';
	if (total > 0) {
		votesText =
			`\n\n**Votes:**\n` +
			`🙋 **I Have**: ${optionHave.size} vote${optionHave.size === 1 ? '' : 's'} (${pHave}%)\n` +
			`🙅 **I Never**: ${optionNever.size} vote${optionNever.size === 1 ? '' : 's'} (${pNever}%)`;
	} else {
		votesText = '\n\nNo votes yet. Be the first to vote!';
	}

	c.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(`**Never Have I Ever...**\n\n*${prompt}*${votesText}`),
	);

	if (!disabled) {
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:nhie:vote:${gameId}:have`)
				.setLabel('I Have 🙋')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:nhie:vote:${gameId}:never`)
				.setLabel('I Never 🙅')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:nhie:next:${gameId}`)
				.setLabel('Another One! 🔄')
				.setStyle(ButtonStyle.Secondary),
		);
		c.addActionRowComponents(row);
	}

	return c;
}

// ── Roasts list ──────────────────────────────────────────────────────────────

export const ROASTS = [
	"{user}, if I had a face like yours, I'd sue my parents.",
	"{user}, you're the reason the gene pool needs a lifeguard.",
	"I'd agree with you {user}, but then we'd both be wrong.",
	'{user}, you have a face for radio and a voice for silent movies.',
	"My phone battery lasts longer than {user}'s relationships.",
	"{user} is like a cloud. When they disappear, it's a beautiful day.",
	'I was going to give you a nasty look {user}, but I see you already have one.',
	"{user}, you're as bright as a black hole and twice as empty.",
	'Some people bring joy wherever they go; {user} brings joy whenever they go.',
	"I'd explain it to you {user}, but I don't have any crayons.",
	"If {user} were any slower, they'd be going backward.",
	"I've seen puddles deeper than {user}'s personality.",
	'{user} is the human equivalent of a participation award.',
	'Your secrets are always safe with me {user}. I never listen anyway.',
	"{user} has the attention span of a goldfish, and that's being generous.",
];

// ── Truths & Dares list ───────────────────────────────────────────────────────

export const TRUTHS = [
	'What is your biggest fear?',
	'Have you ever lied to your best friend?',
	"What is the most embarrassing thing you've ever done?",
	"What is a secret you've never told anyone?",
	'If you could swap lives with anyone in this server, who would it be?',
	'Have you ever cheated on a test?',
	'What is the worst gift you have ever received?',
	'What is your most useless talent?',
	'Who was your first crush?',
	"What is the biggest lie you've ever told your parents?",
	'Have you ever ghosted someone?',
	'What is a weird habit you have?',
];

export const DARES = [
	'Send a funny selfie in this channel or another channel.',
	'Do 10 pushups right now (honors system!).',
	'Type the next 3 messages using only your nose.',
	'Sing the chorus of your favorite song in a voice channel.',
	'Send your most recently used emoji in chat.',
	"Speak in an accent of the group's choice for the next 5 minutes.",
	'Whisper everything you say for the next 10 minutes.',
	'Send a screenshot of your home screen.',
	'Let another user in the server write a status for you.',
	'Do your best impression of a chicken.',
];

export function getRandomTruth(): string {
	return TRUTHS[Math.floor(Math.random() * TRUTHS.length)];
}

export function getRandomDare(): string {
	return DARES[Math.floor(Math.random() * DARES.length)];
}

export const COMPLIMENTS = [
	'you light up every room you walk into.',
	'your vibe is unmatched.',
	'you make hard things look easy.',
	'you’re the kind of person people are lucky to know.',
	'your humor is elite.',
	'you have great energy.',
	'you’re doing better than you think.',
	'you’re built different (in the best way).',
];

export function cardFace(n: number): string {
	const faces = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
	return faces[Math.max(1, Math.min(13, n)) - 1] ?? String(n);
}

@ApplyOptions<Subcommand.Options>({
	name: 'fun',
	description: 'Fun, games, stories, and roleplay actions.',
	subcommands: [
		{
			name: 'games',
			type: 'group',
			entries: [
				{ name: 'connect4', chatInputRun: 'chatInputConnect4' },
				{ name: 'tictactoe', chatInputRun: 'chatInputTicTacToe' },
				{ name: 'trivia', chatInputRun: 'chatInputTrivia' },
				{ name: 'trivia-leaderboard', chatInputRun: 'chatInputTriviaLeaderboard' },
				{ name: 'rps', chatInputRun: 'chatInputRps' },
				{ name: '2048', chatInputRun: 'chatInput2048' },
				{ name: 'minesweeper', chatInputRun: 'chatInputMinesweeper' },
				{ name: 'findtheemoji', chatInputRun: 'chatInputFindTheEmoji' },
				{ name: 'wordle', chatInputRun: 'chatInputWordle' },
				{ name: 'hangman', chatInputRun: 'chatInputHangman' },
				{ name: 'blackjack', chatInputRun: 'chatInputBlackjack' },
				{ name: 'truthordare', chatInputRun: 'chatInputTruthordare' },
				{ name: 'neverhaveiever', chatInputRun: 'chatInputNeverhaveiever' },
			],
		},
		{
			name: 'story',
			type: 'group',
			entries: [
				{ name: 'start', chatInputRun: 'chatInputStoryStart' },
				{ name: 'end', chatInputRun: 'chatInputStoryEnd' },
				{ name: 'current', chatInputRun: 'chatInputStoryCurrent' },
			],
		},
		{
			name: 'rp',
			type: 'group',
			entries: (Object.keys(RP_ACTIONS) as RpActionKey[]).map((name) => ({
				name,
				chatInputRun: 'chatInputRpAction',
			})),
		},
		{ name: '8ball', chatInputRun: 'chatInput8ball' },
		{ name: 'roll', chatInputRun: 'chatInputRoll' },
		{ name: 'coinflip', chatInputRun: 'chatInputCoinflip' },
		{ name: 'choose', chatInputRun: 'chatInputChoose' },
		{ name: 'ship', chatInputRun: 'chatInputShip' },
		{ name: 'joke', chatInputRun: 'chatInputJoke' },
		{ name: 'wouldyourather', chatInputRun: 'chatInputWouldyourather' },
		{ name: 'animal', chatInputRun: 'chatInputAnimal' },
		{ name: 'roast', chatInputRun: 'chatInputRoast' },
		{ name: 'rate', chatInputRun: 'chatInputRate' },
		{ name: 'mock', chatInputRun: 'chatInputMock' },
		{ name: 'reverse', chatInputRun: 'chatInputReverse' },
		{ name: 'emojify', chatInputRun: 'chatInputEmojify' },
		{ name: 'fact', chatInputRun: 'chatInputFact' },
		{ name: 'advice', chatInputRun: 'chatInputAdvice' },
		{ name: 'compliment', chatInputRun: 'chatInputCompliment' },
		{ name: 'guess', chatInputRun: 'chatInputGuess' },
		{ name: 'higherlower', chatInputRun: 'chatInputHigherLower' },
	],
})
export class FunCommand extends Subcommand {
	public override registerApplicationCommands(registry: Subcommand.Registry) {
		registry.registerChatInputCommand((builder) => {
			builder.setName('fun').setDescription('Fun, games, stories, and roleplay actions.');

			// ── Subcommand Group: games ───────────────────────────────────────────────
			builder.addSubcommandGroup((group) =>
				group
					.setName('games')
					.setDescription('Play games or view game stats.')
					// connect4
					.addSubcommand((sub) =>
						sub
							.setName('connect4')
							.setDescription('Challenge someone to a game of Connect 4!')
							.addUserOption((o) => o.setName('opponent').setDescription('The user to challenge.').setRequired(true)),
					)
					// tictactoe
					.addSubcommand((sub) =>
						sub
							.setName('tictactoe')
							.setDescription('Challenge someone to a game of Tic Tac Toe!')
							.addUserOption((o) => o.setName('opponent').setDescription('The user to challenge.').setRequired(true)),
					)
					// trivia
					.addSubcommand((sub) =>
						sub
							.setName('trivia')
							.setDescription('Answer a random trivia question!')
							.addStringOption((o) =>
								o
									.setName('difficulty')
									.setDescription('Question difficulty.')
									.setRequired(false)
									.addChoices(
										{ name: 'Easy', value: 'easy' },
										{ name: 'Medium', value: 'medium' },
										{ name: 'Hard', value: 'hard' },
									),
							)
							.addIntegerOption((o) =>
								o
									.setName('category')
									.setDescription('Category number (from Open Trivia DB).')
									.setRequired(false)
									.setMinValue(9)
									.setMaxValue(32),
							),
					)
					// trivia-leaderboard
					.addSubcommand((sub) =>
						sub.setName('trivia-leaderboard').setDescription('View the trivia leaderboard for this server.'),
					)
					// rps
					.addSubcommand((sub) =>
						sub
							.setName('rps')
							.setDescription('Play Rock Paper Scissors!')
							.addUserOption((o) =>
								o
									.setName('opponent')
									.setDescription('The user to challenge (leave blank to play the bot).')
									.setRequired(false),
							),
					)
					// 2048
					.addSubcommand((sub) => sub.setName('2048').setDescription('Play a game of 2048 in Discord!'))
					// minesweeper
					.addSubcommand((sub) =>
						sub
							.setName('minesweeper')
							.setDescription('Generate a minesweeper board with spoiler tags.')
							.addStringOption((o) =>
								o
									.setName('difficulty')
									.setDescription('Difficulty level (default: easy).')
									.setRequired(false)
									.addChoices(
										{ name: 'Easy (9x9, 10 mines)', value: 'easy' },
										{ name: 'Medium (10x10, 20 mines)', value: 'medium' },
										{ name: 'Hard (12x12, 35 mines)', value: 'hard' },
									),
							),
					)
					// findtheemoji
					.addSubcommand((sub) =>
						sub.setName('findtheemoji').setDescription('Race to find the odd-one-out emoji — anyone can play!'),
					)
					// wordle
					.addSubcommand((sub) => sub.setName('wordle').setDescription('Play a game of Wordle!'))
					// hangman
					.addSubcommand((sub) => sub.setName('hangman').setDescription('Play a game of Hangman!'))
					// blackjack
					.addSubcommand((sub) => sub.setName('blackjack').setDescription('Play a game of Blackjack for fun!'))
					// truthordare
					.addSubcommand((sub) =>
						sub.setName('truthordare').setDescription('Play an interactive game of Truth or Dare!'),
					)
					// neverhaveiever
					.addSubcommand((sub) =>
						sub.setName('neverhaveiever').setDescription('Play a group poll of Never Have I Ever!'),
					),
			);

			// ── Subcommand Group: story ──────────────────────────────────────────────
			builder.addSubcommandGroup((group) =>
				group
					.setName('story')
					.setDescription('Collaborative one-word-at-a-time story.')
					// start
					.addSubcommand((sub) =>
						sub
							.setName('start')
							.setDescription('Start a one-word story in this channel.')
							.addStringOption((o) =>
								o
									.setName('topic')
									.setDescription('Optional opening prompt for the story.')
									.setRequired(false)
									.setMaxLength(100),
							),
					)
					// end
					.addSubcommand((sub) => sub.setName('end').setDescription('End the story and display the full text.'))
					// current
					.addSubcommand((sub) => sub.setName('current').setDescription('Show the story so far.')),
			);

			// ── Subcommand Group: rp ─────────────────────────────────────────────────
			builder.addSubcommandGroup((group) => {
				group.setName('rp').setDescription('Roleplay actions.');

				for (const [name, action] of Object.entries(RP_ACTIONS) as [RpActionKey, (typeof RP_ACTIONS)[RpActionKey]][]) {
					const isSelfOnly = SELF_ACTIONS.includes(name);
					const isOptional = OPTIONAL_TARGET_ACTIONS.includes(name);

					if (isSelfOnly) {
						group.addSubcommand((sub) =>
							sub
								.setName(name)
								.setDescription(`${action.emoji} ${action.verb.charAt(0).toUpperCase() + action.verb.slice(1)}..`),
						);
					} else {
						group.addSubcommand((sub) =>
							sub
								.setName(name)
								.setDescription(
									`${action.emoji} ${action.verb.charAt(0).toUpperCase() + action.verb.slice(1)} someone.`,
								)
								.addUserOption((o) => o.setName('user').setDescription('The user to target.').setRequired(!isOptional)),
						);
					}
				}

				return group;
			});

			// ── 8ball ────────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('8ball')
					.setDescription('Ask the Magic 8-Ball a question.')
					.addStringOption((o) =>
						o.setName('question').setDescription('Your question.').setRequired(true).setMaxLength(256),
					),
			);

			// ── roll ─────────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('roll')
					.setDescription('Roll dice (e.g. 1d6, 2d20, d100+5).')
					.addStringOption((o) =>
						o.setName('dice').setDescription('The dice notation (default: 1d6).').setRequired(false).setMaxLength(32),
					),
			);

			// ── coinflip ─────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('coinflip')
					.setDescription('Flip a coin.')
					.addStringOption((o) =>
						o
							.setName('guess')
							.setDescription('Your guess.')
							.setRequired(false)
							.addChoices({ name: 'Heads', value: 'heads' }, { name: 'Tails', value: 'tails' }),
					),
			);

			// ── choose ───────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('choose')
					.setDescription('Choose from a list of options.')
					.addStringOption((o) =>
						o
							.setName('options')
							.setDescription('The choices (separated by commas or pipes).')
							.setRequired(true)
							.setMaxLength(500),
					),
			);

			// ── ship ─────────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('ship')
					.setDescription('Check compatibility between two users.')
					.addUserOption((o) => o.setName('user1').setDescription('First user.').setRequired(true))
					.addUserOption((o) =>
						o.setName('user2').setDescription('Second user (optional, defaults to you).').setRequired(false),
					),
			);

			// ── joke ─────────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) => sub.setName('joke').setDescription('Get a random dad joke.'));

			// ── wouldyourather ───────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub.setName('wouldyourather').setDescription('Get a random Would You Rather question to vote on.'),
			);

			// ── animal ───────────────────────────────────────────────────────────────
			builder.addSubcommand((sub) =>
				sub
					.setName('animal')
					.setDescription('Get a random cute animal photo!')
					.addStringOption((o) =>
						o
							.setName('type')
							.setDescription('The type of animal.')
							.setRequired(true)
							.addChoices(
								{ name: 'Cat 🐱', value: 'cat' },
								{ name: 'Dog 🐶', value: 'dog' },
								{ name: 'Fox 🦊', value: 'fox' },
								{ name: 'Panda 🐼', value: 'panda' },
								{ name: 'Red Panda 🏮', value: 'redpanda' },
								{ name: 'Koala 🐨', value: 'koala' },
								{ name: 'Bird 🐦', value: 'bird' },
								{ name: 'Raccoon 🦝', value: 'raccoon' },
								{ name: 'Kangaroo 🦘', value: 'kangaroo' },
								{ name: 'Pikachu ⚡', value: 'pikachu' },
							),
					),
			);

			builder.addSubcommand((sub) =>
				sub
					.setName('roast')
					.setDescription('Roast someone (all in good fun).')
					.addUserOption((o) => o.setName('user').setDescription('Victim (defaults to you).').setRequired(false)),
			);
			builder.addSubcommand((sub) =>
				sub
					.setName('rate')
					.setDescription('Rate something out of 10.')
					.addStringOption((o) =>
						o.setName('thing').setDescription('What to rate.').setRequired(true).setMaxLength(100),
					),
			);
			builder.addSubcommand((sub) =>
				sub
					.setName('mock')
					.setDescription('SpOnGeBoB mOcK text.')
					.addStringOption((o) =>
						o.setName('text').setDescription('Text to mock.').setRequired(true).setMaxLength(500),
					),
			);
			builder.addSubcommand((sub) =>
				sub
					.setName('reverse')
					.setDescription('Reverse some text.')
					.addStringOption((o) =>
						o.setName('text').setDescription('Text to reverse.').setRequired(true).setMaxLength(500),
					),
			);
			builder.addSubcommand((sub) =>
				sub
					.setName('emojify')
					.setDescription('Turn letters into regional indicator emojis.')
					.addStringOption((o) =>
						o.setName('text').setDescription('Text to emojify.').setRequired(true).setMaxLength(80),
					),
			);
			builder.addSubcommand((sub) => sub.setName('fact').setDescription('Get a random useless fact.'));
			builder.addSubcommand((sub) => sub.setName('advice').setDescription('Get a random piece of advice.'));
			builder.addSubcommand((sub) =>
				sub
					.setName('compliment')
					.setDescription('Compliment someone.')
					.addUserOption((o) => o.setName('user').setDescription('Who to compliment.').setRequired(false)),
			);
			builder.addSubcommand((sub) =>
				sub
					.setName('guess')
					.setDescription('Guess a number between 1 and 100.')
					.addIntegerOption((o) =>
						o.setName('number').setDescription('Your guess.').setRequired(true).setMinValue(1).setMaxValue(100),
					),
			);
			builder.addSubcommand((sub) =>
				sub.setName('higherlower').setDescription('Higher or lower — guess if the next card is higher.'),
			);

			return builder;
		});
	}

	// ─── Subcommands: game ───────────────────────────────────────────────────────

	public async chatInputConnect4(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const opponent = interaction.options.getUser('opponent', true);
		if (opponent.bot) return interaction.editReply(errorReply('You cannot challenge a bot!'));
		if (opponent.id === interaction.user.id) return interaction.editReply(errorReply('You cannot challenge yourself!'));

		const challenger = interaction.user;

		const container = makeContainer({ color: Colors.Info });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Connect 4 Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game!\n\n<@${opponent.id}>, do you accept?`,
			),
		);

		const msg = await interaction.editReply({
			components: [container],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;
		const containerWithButtons = makeContainer({ color: Colors.Info });
		containerWithButtons.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Connect 4 Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game!\n\n<@${opponent.id}>, do you accept?`,
			),
		);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:c4:accept:${msgId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`game:c4:decline:${msgId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
		);
		containerWithButtons.addActionRowComponents(row);

		await interaction.editReply({
			components: [containerWithButtons],
			flags: CV2_FLAG as any,
		});

		const timeout = setTimeout(() => {
			pendingGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### ⚔️ Connect 4 Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** — challenge expired.`,
				),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000);

		pendingGames.set(msgId, {
			type: 'c4',
			challengerId: challenger.id,
			targetId: opponent.id,
			guildId: interaction.guildId,
			timeout,
		});

		return null;
	}

	public async chatInputTicTacToe(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const opponent = interaction.options.getUser('opponent', true);
		if (opponent.bot) return interaction.editReply(errorReply('You cannot challenge a bot!'));
		if (opponent.id === interaction.user.id) return interaction.editReply(errorReply('You cannot challenge yourself!'));

		const challenger = interaction.user;

		const container = makeContainer({ color: Colors.Info });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Tic Tac Toe Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game!\n\n<@${opponent.id}>, do you accept?`,
			),
		);

		const msg = await interaction.editReply({
			components: [container],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;
		const containerWithButtons = makeContainer({ color: Colors.Info });
		containerWithButtons.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Tic Tac Toe Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game!\n\n<@${opponent.id}>, do you accept?`,
			),
		);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:ttt:accept:${msgId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`game:ttt:decline:${msgId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
		);
		containerWithButtons.addActionRowComponents(row);

		await interaction.editReply({
			components: [containerWithButtons],
			flags: CV2_FLAG as any,
		});

		const timeout = setTimeout(() => {
			pendingGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### ⚔️ Tic Tac Toe Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** — challenge expired.`,
				),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000);

		pendingGames.set(msgId, {
			type: 'ttt',
			challengerId: challenger.id,
			targetId: opponent.id,
			guildId: interaction.guildId,
			timeout,
		});

		return null;
	}

	public async chatInputTrivia(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const difficulty = interaction.options.getString('difficulty');
		const category = interaction.options.getInteger('category');

		let url = 'https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986';
		if (difficulty) url += `&difficulty=${difficulty}`;
		if (category) url += `&category=${category}`;

		let data: TriviaResponse;
		try {
			const res = await fetch(url);
			if (!res.ok) return interaction.editReply(errorReply('Failed to fetch trivia question. Try again later.'));
			data = (await res.json()) as TriviaResponse;
		} catch {
			return interaction.editReply(errorReply('Failed to fetch trivia question. Try again later.'));
		}

		if (data.response_code !== 0 || !data.results.length) {
			return interaction.editReply(
				errorReply('No trivia question available for that selection. Try different options.'),
			);
		}

		const q = data.results[0];
		const question = decodeURIComponent(q.question);
		const correct = decodeURIComponent(q.correct_answer);
		const incorrectAnswers = q.incorrect_answers.map((a) => decodeURIComponent(a));
		const categoryDecoded = decodeURIComponent(q.category);
		const difficultyDecoded = decodeURIComponent(q.difficulty);

		const answers = [correct, ...incorrectAnswers].sort(() => Math.random() - 0.5);

		const container = makeContainer({ color: Colors.Info });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### ❓ Trivia — ${categoryDecoded} (${difficultyDecoded})`),
		);
		container.addSeparatorComponents(separator());
		container.addTextDisplayComponents(new TextDisplayBuilder().setContent(question));
		container.addSeparatorComponents(separator());

		const msg = await interaction.editReply({
			components: [container],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;
		const LABELS = ['A', 'B', 'C', 'D'];

		const containerWithButtons = makeContainer({ color: Colors.Info });
		containerWithButtons.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### ❓ Trivia — ${categoryDecoded} (${difficultyDecoded})`),
		);
		containerWithButtons.addSeparatorComponents(separator());
		containerWithButtons.addTextDisplayComponents(new TextDisplayBuilder().setContent(question));
		containerWithButtons.addSeparatorComponents(separator());

		const answerRow = new ActionRowBuilder<ButtonBuilder>();
		for (let i = 0; i < answers.length; i++) {
			answerRow.addComponents(
				new ButtonBuilder()
					.setCustomId(`game:trivia:answer:${msgId}:${i}`)
					.setLabel(`${LABELS[i]}: ${answers[i].slice(0, 80)}`)
					.setStyle(ButtonStyle.Primary),
			);
		}
		containerWithButtons.addActionRowComponents(answerRow);

		await interaction.editReply({
			components: [containerWithButtons],
			flags: CV2_FLAG as any,
		});

		const timeout = setTimeout(() => {
			triviaGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`### ❓ Trivia — ${categoryDecoded} (${difficultyDecoded})`),
			);
			expiredContainer.addSeparatorComponents(separator());
			expiredContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(question));
			expiredContainer.addSeparatorComponents(separator());
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`⏰ Time's up! The correct answer was **${correct}**.`),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 30_000);

		triviaGames.set(msgId, {
			correct,
			answers,
			userId: interaction.user.id,
			guildId: interaction.guildId,
			answered: false,
			timeout,
		});

		return null;
	}

	public async chatInputTriviaLeaderboard(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const rows = await db.query.triviaScores.findMany({
			where: eq(schema.triviaScores.guildId, interaction.guildId),
			orderBy: [desc(schema.triviaScores.wins)],
			limit: 10,
		});

		if (!rows.length) return interaction.editReply(errorReply('No trivia scores yet. Play trivia first!'));

		const medals = ['🥇', '🥈', '🥉'];
		const lines = rows.map((row, i) => {
			const medal = medals[i] ?? `**${i + 1}.**`;
			const pct = row.total > 0 ? Math.round((row.wins / row.total) * 100) : 0;
			const self = row.userId === interaction.user.id ? ' ← you' : '';
			return `${medal} <@${row.userId}> — **${row.wins}** wins / ${row.total} played (${pct}%)${self}`;
		});

		const c = makeContainer({ color: Colors.Info, header: 'Trivia Leaderboard' });
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Top ${rows.length} players in this server`));

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	// ─── Subcommands: story ──────────────────────────────────────────────────────

	public async chatInputStoryStart(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		if (storySessions.has(interaction.channelId)) {
			return interaction.editReply(errorReply('A story is already running in this channel. End it first.'));
		}

		const topic = interaction.options.getString('topic');

		const c = makeContainer({ color: Colors.Success });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### 📖 One-Word Story${topic ? ` — *${topic}*` : ''}\nTake turns adding **one word at a time** to build a story. You can't go twice in a row.\n\nUse \`/fun story end\` to finish, or \`/fun story current\` to see the full text.\n\n-# Started by <@${interaction.user.id}>`,
			),
		);

		const headerMsg = await interaction.channel!.send({ components: [c], flags: CV2_FLAG as any });

		storySessions.set(interaction.channelId, {
			words: [],
			lastUserId: null,
			startedById: interaction.user.id,
			guildId: interaction.guildId,
			channelId: interaction.channelId,
			topic,
			headerMessageId: headerMsg.id,
		});

		return interaction.editReply(successReply('Story started! Add one word at a time in this channel.'));
	}

	public async chatInputStoryEnd(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const session = storySessions.get(interaction.channelId);
		if (!session) return interaction.editReply(errorReply('No story is running in this channel.'));

		storySessions.delete(interaction.channelId);

		if (session.words.length === 0) {
			return interaction.editReply(successReply('Story ended with no words written.'));
		}

		const storyText = session.words.join(' ');
		const c = makeContainer({ color: Colors.Info });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### 📖 The Story${session.topic ? ` — *${session.topic}*` : ''}`),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(storyText));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`-# ${session.words.length} word${session.words.length === 1 ? '' : 's'} • Ended by <@${interaction.user.id}>`,
			),
		);

		await interaction.channel!.send({ components: [c], flags: CV2_FLAG as any });
		return interaction.editReply(successReply('Story ended and posted!'));
	}

	public async chatInputStoryCurrent(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const session = storySessions.get(interaction.channelId);
		if (!session) return interaction.editReply(errorReply('No story is running in this channel.'));

		if (session.words.length === 0) {
			return interaction.editReply(errorReply('No words have been added yet!'));
		}

		const storyText = session.words.join(' ');
		const c = makeContainer({ color: Colors.Info });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`### 📖 Story So Far${session.topic ? ` — *${session.topic}*` : ''}`),
		);
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(storyText));
		c.addSeparatorComponents(separator());
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`-# ${session.words.length} word${session.words.length === 1 ? '' : 's'}`),
		);

		return interaction.editReply({ components: [c], flags: (CV2_FLAG | MessageFlags.Ephemeral) as any });
	}

	// ─── Subcommands: rp ──────────────────────────────────────────────────────────

	public async chatInputRpAction(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const subcommand = interaction.options.getSubcommand() as RpActionKey;
		const action = RP_ACTIONS[subcommand];
		if (!action) return interaction.editReply(errorReply('Unknown action.'));

		const target = interaction.options.getUser('user');
		const actor = interaction.user;

		let text: string;
		const isSelfOnly = SELF_ACTIONS.includes(subcommand);

		if (isSelfOnly || !target) {
			text = `${action.emoji} <@${actor.id}> ${action.verb}!`;
		} else {
			text = `${action.emoji} <@${actor.id}> ${action.verb} <@${target.id}>!`;
		}

		// Fetch GIF from nekos.best
		let gifUrl: string;
		try {
			const res = await fetch(`https://nekos.best/api/v2/${action.api}`);
			if (!res.ok) return interaction.editReply(errorReply('Failed to fetch GIF. Try again later.'));
			const data = (await res.json()) as NekosResult;
			if (!data.results?.length) return interaction.editReply(errorReply('No GIF found for this action.'));
			gifUrl = data.results[0].url;
		} catch {
			return interaction.editReply(errorReply('Failed to fetch GIF. Try again later.'));
		}

		const c = makeContainer({ color: Colors.Voice });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
		c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(gifUrl)));

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputRps(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const opponent = interaction.options.getUser('opponent');

		// Playing against the bot
		if (!opponent || opponent.id === interaction.client.user.id) {
			const c = makeContainer({ color: Colors.Info });
			c.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### ✊ Rock Paper Scissors\nPlay against the bot! Choose your move below:`,
				),
			);
			const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				new ButtonBuilder().setCustomId('game:rps:move_bot:rock').setLabel('Rock ✊').setStyle(ButtonStyle.Primary),
				new ButtonBuilder().setCustomId('game:rps:move_bot:paper').setLabel('Paper ✋').setStyle(ButtonStyle.Primary),
				new ButtonBuilder()
					.setCustomId('game:rps:move_bot:scissors')
					.setLabel('Scissors ✌️')
					.setStyle(ButtonStyle.Primary),
			);
			c.addActionRowComponents(row);

			return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
		}

		if (opponent.bot) return interaction.editReply(errorReply('You cannot challenge a bot other than Erica!'));
		if (opponent.id === interaction.user.id) return interaction.editReply(errorReply('You cannot challenge yourself!'));

		const challenger = interaction.user;

		const container = makeContainer({ color: Colors.Info });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Rock Paper Scissors Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game of Rock Paper Scissors!\n\n<@${opponent.id}>, do you accept?`,
			),
		);

		const msg = await interaction.editReply({
			components: [container],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;
		const containerWithButtons = makeContainer({ color: Colors.Info });
		containerWithButtons.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### ⚔️ Rock Paper Scissors Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** to a game of Rock Paper Scissors!\n\n<@${opponent.id}>, do you accept?`,
			),
		);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:rps:accept:${msgId}`).setLabel('Accept').setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(`game:rps:decline:${msgId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
		);
		containerWithButtons.addActionRowComponents(row);

		await interaction.editReply({
			components: [containerWithButtons],
			flags: CV2_FLAG as any,
		});

		const timeout = setTimeout(() => {
			pendingGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### ⚔️ Rock Paper Scissors Challenge\n**${challenger.displayName}** challenged **${opponent.displayName}** — challenge expired.`,
				),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000);

		pendingGames.set(msgId, {
			type: 'rps',
			challengerId: challenger.id,
			targetId: opponent.id,
			guildId: interaction.guildId,
			timeout,
		});

		return null;
	}

	public async chatInput8ball(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const question = interaction.options.getString('question', true);
		const responses = [
			'It is certain.',
			'It is decidedly so.',
			'Without a doubt.',
			'Yes definitely.',
			'You may rely on it.',
			'As I see it, yes.',
			'Most likely.',
			'Outlook good.',
			'Yes.',
			'Signs point to yes.',
			'Reply hazy, try again.',
			'Ask again later.',
			'Better not tell you now.',
			'Cannot predict now.',
			'Concentrate and ask again.',
			"Don't count on it.",
			'My reply is no.',
			'My sources say no.',
			'Outlook not so good.',
			'Very doubtful.',
		];

		const answer = responses[Math.floor(Math.random() * responses.length)];

		const c = makeContainer({ color: Colors.Info, header: 'Magic 8-Ball' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Question:** ${question}\n**Answer:** ${answer}`));

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputRoll(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const diceStr = (interaction.options.getString('dice') ?? '1d6').trim().toLowerCase();

		const match = diceStr.match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/);
		if (!match) {
			return interaction.editReply(
				errorReply('Invalid dice notation. Use formats like `2d6`, `1d20`, `d100`, or `3d10+5`.'),
			);
		}

		const count = match[1] === '' ? 1 : parseInt(match[1], 10);
		const sides = parseInt(match[2], 10);
		const sign = match[3];
		const modifier = match[4] ? parseInt(match[4], 10) : 0;

		if (count < 1 || count > 100) {
			return interaction.editReply(errorReply('You can only roll between 1 and 100 dice.'));
		}
		if (sides < 2 || sides > 1000) {
			return interaction.editReply(errorReply('Dice must have between 2 and 1000 sides.'));
		}

		const rolls: number[] = [];
		let sum = 0;
		for (let i = 0; i < count; i++) {
			const roll = Math.floor(Math.random() * sides) + 1;
			rolls.push(roll);
			sum += roll;
		}

		let total = sum;
		let modText = '';
		if (sign && modifier > 0) {
			if (sign === '+') {
				total += modifier;
				modText = ` + ${modifier}`;
			} else {
				total -= modifier;
				modText = ` - ${modifier}`;
			}
		}

		const rollsText =
			rolls.length > 10 ? `${rolls.slice(0, 10).join(', ')}... (+${rolls.length - 10} more)` : rolls.join(', ');

		const c = makeContainer({ color: Colors.Info, header: 'Dice Roll' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Rolled **${count}d${sides}${modText}**\n\n**Rolls:** [${rollsText}]\n**Total:** **${total}**`,
			),
		);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputCoinflip(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const guess = interaction.options.getString('guess');
		const result = Math.random() < 0.5 ? 'heads' : 'tails';
		const resultLabel = result === 'heads' ? 'Heads 🪙' : 'Tails 🪙';

		let description = `The coin landed on **${resultLabel}**!`;
		let color: number = Colors.Info;

		if (guess) {
			if (guess === result) {
				description = `🎉 **You guessed right!** The coin landed on **${resultLabel}**.`;
				color = Colors.Success;
			} else {
				description = `😢 **You guessed wrong.** The coin landed on **${resultLabel}**.`;
				color = Colors.Error;
			}
		}

		const c = makeContainer({ color, header: 'Coin Flip' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputChoose(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const optionsStr = interaction.options.getString('options', true);
		const delimiters = [',', '|'];
		let choices: string[] = [];

		let splitDone = false;
		for (const delim of delimiters) {
			if (optionsStr.includes(delim)) {
				choices = optionsStr
					.split(delim)
					.map((c) => c.trim())
					.filter((c) => c.length > 0);
				splitDone = true;
				break;
			}
		}
		if (!splitDone) {
			choices = optionsStr
				.split(/\s+/)
				.map((c) => c.trim())
				.filter((c) => c.length > 0);
		}

		if (choices.length < 2) {
			return interaction.editReply(errorReply('Provide at least 2 options separated by commas, pipes, or spaces.'));
		}

		const picked = choices[Math.floor(Math.random() * choices.length)];

		const c = makeContainer({ color: Colors.Info, header: 'Choice Maker' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Given choices: ${choices.map((c) => `\`${c}\``).join(', ')}\n\nI choose: **${picked}**!`,
			),
		);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputShip(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const user1 = interaction.options.getUser('user1', true);
		const user2 = interaction.options.getUser('user2') ?? interaction.user;

		let pct: number;
		if (user1.id === user2.id) {
			pct = 100;
		} else {
			const ids = [user1.id, user2.id].sort();
			const combined = ids[0] + ids[1];

			let hash = 0;
			for (let i = 0; i < combined.length; i++) {
				hash = combined.charCodeAt(i) + ((hash << 5) - hash);
			}
			pct = Math.abs(hash % 101);
		}

		let comment = '';
		if (pct <= 10) comment = 'Terrible match. 💔';
		else if (pct <= 30) comment = 'Not looking good... 📉';
		else if (pct <= 50) comment = 'There might be a spark, but it needs work. ⚡';
		else if (pct <= 70) comment = 'A solid match! 👍';
		else if (pct <= 90) comment = 'Amazing chemistry! 💖';
		else comment = 'True soulmates! 💕';

		const filledHearts = Math.round(pct / 10);
		const emptyHearts = 10 - filledHearts;
		const bar = '❤️'.repeat(filledHearts) + '🖤'.repeat(emptyHearts);

		const c = makeContainer({ color: Colors.Moderation, header: 'Love Ship Compatibility' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Shipping **${user1.displayName}** with **${user2.displayName}**!\n\n` +
					`**Score:** **${pct}%**\n` +
					`\`[${bar}]\`\n\n` +
					`**Verdict:** ${comment}`,
			),
		);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputJoke(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const joke = await fetchJoke();

		const c = makeContainer({ color: Colors.Info, header: 'Joke' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(joke));

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId('game:joke:next').setLabel('Another One! 🔄').setStyle(ButtonStyle.Secondary),
		);
		c.addActionRowComponents(row);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputWouldyourather(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const question = getRandomWYR();
		const reply = await interaction.fetchReply();
		const msgId = reply.id;

		const container = makeContainer({ color: Colors.Info, header: 'Would You Rather' });
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`Would you rather...\n\n` +
					`🔵 **Option 1**: ${question.option1}\n` +
					`🔴 **Option 2**: ${question.option2}\n\n` +
					`No votes yet. Be the first to vote!`,
			),
		);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(`game:wyr:vote:${msgId}:1`).setLabel('Option 1 🔵').setStyle(ButtonStyle.Primary),
			new ButtonBuilder().setCustomId(`game:wyr:vote:${msgId}:2`).setLabel('Option 2 🔴').setStyle(ButtonStyle.Primary),
		);
		container.addActionRowComponents(row);

		const timeout = setTimeout(() => {
			wyrGames.delete(msgId);
		}, 7_200_000); // 2 hours

		wyrGames.set(msgId, {
			option1: new Set<string>(),
			option2: new Set<string>(),
			option1Text: question.option1,
			option2Text: question.option2,
			timeout,
		});

		return interaction.editReply({
			components: [container],
			flags: CV2_FLAG as any,
		});
	}

	public async chatInputAnimal(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const type = interaction.options.getString('type', true);

		let imageUrl: string;
		try {
			imageUrl = await fetchAnimalImage(type);
		} catch (_err) {
			return interaction.editReply(errorReply('Failed to fetch a cute animal image. Please try again.'));
		}

		if (!imageUrl) {
			return interaction.editReply(errorReply('Could not retrieve an image. Please try again.'));
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

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInput2048(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const board = init2048Board();

		const tempContainer = makeContainer({ color: Colors.Info, header: '2048' });
		tempContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🎮 2048\nPreparing the board...'));

		const msg = await interaction.editReply({
			components: [tempContainer],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;

		const timeout = setTimeout(() => {
			games2048.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`### 🎮 2048\nGame timed out. Final score: **0**`),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000); // 5 minutes

		games2048.set(msgId, {
			board,
			score: 0,
			userId: interaction.user.id,
			timeout,
		});

		const card = build2048Components(msgId, board, 0, false);
		await interaction.editReply({
			components: [card],
			flags: CV2_FLAG as any,
		});

		return null;
	}

	public async chatInputMinesweeper(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const difficulty = interaction.options.getString('difficulty') ?? 'easy';
		let rows = 9;
		let cols = 9;
		let mines = 10;
		let difficultyName = 'Easy';

		if (difficulty === 'medium') {
			rows = 10;
			cols = 10;
			mines = 20;
			difficultyName = 'Medium';
		} else if (difficulty === 'hard') {
			rows = 12;
			cols = 12;
			mines = 35;
			difficultyName = 'Hard';
		}

		const boardText = generateMinesweeperBoard(rows, cols, mines);
		const c = makeContainer({ color: Colors.Info, header: `Minesweeper — ${difficultyName}` });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				`### 💣 Minesweeper\nDifficulty: **${difficultyName}** (${rows}x${cols}, ${mines} mines)\n\n*Click on the spoilers to reveal the board! Don't step on a mine!*\n\n${boardText}`,
			),
		);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputFindTheEmoji(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const pair = EMOJI_PAIRS[Math.floor(Math.random() * EMOJI_PAIRS.length)];
		const oddIdx = Math.floor(Math.random() * 9);

		const tempContainer = makeContainer({ color: Colors.Info, header: 'Find the Emoji' });
		tempContainer.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('### 🔍 Find the Emoji\nPreparing the board...'),
		);

		const msg = await interaction.editReply({
			components: [tempContainer],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;

		const timeout = setTimeout(() => {
			findTheEmojiGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(
					`### 🔍 Find the Emoji\nTime's up — nobody found it. The odd emoji was **${pair.odd}**.`,
				),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 45_000);

		findTheEmojiGames.set(msgId, {
			commonEmoji: pair.common,
			oddEmoji: pair.odd,
			oddIdx,
			hostId: interaction.user.id,
			wrongGuessers: new Set(),
			timeout,
		});

		const card = buildFindTheEmojiComponents(msgId, pair.common, pair.odd, oddIdx, false);
		await interaction.editReply({
			components: [card],
			flags: CV2_FLAG as any,
		});

		return null;
	}

	public async chatInputWordle(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const word = WORDLE_WORDS[Math.floor(Math.random() * WORDLE_WORDS.length)];

		const tempContainer = makeContainer({ color: Colors.Info, header: 'Wordle' });
		tempContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Preparing the board...'));

		const msg = await interaction.editReply({
			components: [tempContainer],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;

		const timeout = setTimeout(() => {
			wordleGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`Game timed out. The word was **${word.toUpperCase()}**.`),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000); // 5 minutes

		wordleGames.set(msgId, {
			word,
			guesses: [],
			userId: interaction.user.id,
			timeout,
		});

		const { container, files } = buildWordleComponents(msgId, word, [], false);
		await interaction.editReply({
			components: [container],
			files,
			flags: CV2_FLAG as any,
		});

		return null;
	}

	public async chatInputHangman(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];

		const tempContainer = makeContainer({ color: Colors.Info, header: 'Hangman' });
		tempContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Preparing the board...'));

		const msg = await interaction.editReply({
			components: [tempContainer],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;

		const timeout = setTimeout(() => {
			hangmanGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(`Game timed out. The word was **${word.toUpperCase()}**.`),
			);
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000); // 5 minutes

		hangmanGames.set(msgId, {
			word,
			guesses: [],
			wrongCount: 0,
			userId: interaction.user.id,
			timeout,
		});

		const { container, files } = buildHangmanComponents(msgId, word, [], 0, false);
		await interaction.editReply({
			components: [container],
			files,
			flags: CV2_FLAG as any,
		});

		return null;
	}

	public async chatInputBlackjack(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const deck = shuffleDeck(buildDeck());
		const playerHand: BjCard[] = [deck.pop()!, deck.pop()!];
		const dealerHand: BjCard[] = [deck.pop()!, deck.pop()!];

		const tempContainer = makeContainer({ color: Colors.Info, header: 'Blackjack' });
		tempContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('Preparing the board...'));

		const msg = await interaction.editReply({
			components: [tempContainer],
			flags: CV2_FLAG as any,
		});

		const msgId = msg.id;

		const timeout = setTimeout(() => {
			funBlackjackGames.delete(msgId);
			const expiredContainer = makeContainer({ color: Colors.Neutral });
			expiredContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`Game timed out.`));
			interaction
				.editReply({
					components: [expiredContainer],
					flags: CV2_FLAG as any,
				})
				.catch(() => null);
		}, 300_000); // 5 minutes

		funBlackjackGames.set(msgId, {
			deck,
			playerHand,
			dealerHand,
			userId: interaction.user.id,
			guildId: interaction.guildId,
			timeout,
		});

		if (handTotal(playerHand) === 21) {
			clearTimeout(timeout);
			funBlackjackGames.delete(msgId);

			const { container, files } = buildBlackjackComponents(
				msgId,
				playerHand,
				dealerHand,
				true,
				false,
				'Blackjack! You got 21 and win!',
			);
			await interaction.editReply({
				components: [container],
				files,
				flags: CV2_FLAG as any,
			});
			return null;
		}

		const { container, files } = buildBlackjackComponents(msgId, playerHand, dealerHand, false, true);
		await interaction.editReply({
			components: [container],
			files,
			flags: CV2_FLAG as any,
		});

		return null;
	}

	public async chatInputRoast(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const target = interaction.options.getUser('user') ?? interaction.user;
		const roast = ROASTS[Math.floor(Math.random() * ROASTS.length)];
		const text = roast.replace('{user}', `<@${target.id}>`);

		const c = makeContainer({ color: Colors.Info, header: 'Roast' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputRate(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const thing = interaction.options.getString('thing', true);
		const score = Math.floor(Math.random() * 11);
		const bar = '█'.repeat(score) + '░'.repeat(10 - score);
		const c = makeContainer({ color: Colors.Info, header: 'Rate' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${thing}**\n\`${bar}\` **${score}/10**`));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputMock(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const text = interaction.options.getString('text', true);
		const mocked = [...text].map((ch, i) => (i % 2 ? ch.toUpperCase() : ch.toLowerCase())).join('');
		const c = makeContainer({ color: Colors.Info, header: 'Mock' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(mocked.slice(0, 1900)));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputReverse(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const text = interaction.options.getString('text', true);
		const c = makeContainer({ color: Colors.Info, header: 'Reverse' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent([...text].reverse().join('').slice(0, 1900)));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputEmojify(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const text = interaction.options.getString('text', true).toLowerCase();
		const out = [...text]
			.map((ch) => {
				if (ch >= 'a' && ch <= 'z') return `:regional_indicator_${ch}:`;
				if (ch === ' ') return '   ';
				return ch;
			})
			.join(' ');
		const c = makeContainer({ color: Colors.Info, header: 'Emojify' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(out.slice(0, 1900) || '*empty*'));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputFact(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		try {
			const res = await fetch('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en');
			const data = (await res.json()) as { text?: string };
			const c = makeContainer({ color: Colors.Info, header: 'Random fact' });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(data.text ?? 'No fact found.'));
			return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
		} catch {
			return interaction.editReply(errorReply('Could not fetch a fact right now.'));
		}
	}

	public async chatInputAdvice(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		try {
			const res = await fetch('https://api.adviceslip.com/advice');
			const data = (await res.json()) as { slip?: { advice?: string } };
			const c = makeContainer({ color: Colors.Info, header: 'Advice' });
			c.addTextDisplayComponents(new TextDisplayBuilder().setContent(data.slip?.advice ?? 'Stay hydrated.'));
			return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
		} catch {
			return interaction.editReply(errorReply('Could not fetch advice right now.'));
		}
	}

	public async chatInputCompliment(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const target = interaction.options.getUser('user') ?? interaction.user;
		const line = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)]!;
		const c = makeContainer({ color: Colors.Success, header: 'Compliment' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@${target.id}> — ${line}`));
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputGuess(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const guess = interaction.options.getInteger('number', true);
		const secret = Math.floor(Math.random() * 100) + 1;
		const diff = Math.abs(secret - guess);
		const verdict = guess === secret ? 'Exact hit!' : diff <= 5 ? 'So close!' : diff <= 15 ? 'Warm.' : 'Cold.';
		const c = makeContainer({ color: Colors.Info, header: 'Guess' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`You guessed **${guess}** — the number was **${secret}**.\n${verdict}`),
		);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputHigherLower(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!(await this.ensureFun(interaction))) return;
		const current = Math.floor(Math.random() * 13) + 1;
		const next = Math.floor(Math.random() * 13) + 1;
		const c = makeContainer({ color: Colors.Info, header: 'Higher or Lower' });
		c.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`Current card: **${cardFace(current)}**\nWill the next be higher or lower?`),
		);
		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:hl:higher:${interaction.user.id}:${current}:${next}`)
				.setLabel('Higher')
				.setStyle(ButtonStyle.Success),
			new ButtonBuilder()
				.setCustomId(`game:hl:lower:${interaction.user.id}:${current}:${next}`)
				.setLabel('Lower')
				.setStyle(ButtonStyle.Danger),
			new ButtonBuilder()
				.setCustomId(`game:hl:same:${interaction.user.id}:${current}:${next}`)
				.setLabel('Same')
				.setStyle(ButtonStyle.Secondary),
		);
		c.addActionRowComponents(row);
		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	private async ensureFun(interaction: Subcommand.ChatInputCommandInteraction): Promise<boolean> {
		if (!interaction.inCachedGuild()) {
			await interaction.editReply(errorReply('Server only.'));
			return false;
		}
		if (!(await isModuleEnabled(interaction.guildId, 'fun'))) {
			await interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));
			return false;
		}
		return true;
	}

	public async chatInputTruthordare(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const c = makeContainer({ color: Colors.Info, header: 'Truth or Dare' });
		c.addTextDisplayComponents(new TextDisplayBuilder().setContent('### 🎲 Truth or Dare\nChoose your path below!'));

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`game:truthordare:truth:${interaction.user.id}`)
				.setLabel('Truth 💬')
				.setStyle(ButtonStyle.Primary),
			new ButtonBuilder()
				.setCustomId(`game:truthordare:dare:${interaction.user.id}`)
				.setLabel('Dare ⚡')
				.setStyle(ButtonStyle.Primary),
		);
		c.addActionRowComponents(row);

		return interaction.editReply({ components: [c], flags: CV2_FLAG as any });
	}

	public async chatInputNeverhaveiever(interaction: Subcommand.ChatInputCommandInteraction) {
		await interaction.deferReply();
		if (!interaction.inCachedGuild()) return interaction.editReply(errorReply('Server only.'));
		if (!(await isModuleEnabled(interaction.guildId, 'fun')))
			return interaction.editReply(errorReply('The Fun & Games module is disabled on this server.'));

		const prompt = NHIE_PROMPTS[Math.floor(Math.random() * NHIE_PROMPTS.length)];

		// Fetch the deferred reply so we key the session to the real message id
		const msg = await interaction.fetchReply();
		const msgId = msg.id;

		const timeout = setTimeout(() => {
			nhieGames.delete(msgId);
		}, 7_200_000); // 2 hours

		nhieGames.set(msgId, {
			optionHave: new Set<string>(),
			optionNever: new Set<string>(),
			prompt,
			timeout,
		});

		const card = buildNHIEComponents(msgId, prompt, new Set(), new Set(), false);
		await interaction.editReply({
			components: [card],
			flags: CV2_FLAG as any,
		});

		return null;
	}
}

// ── Would You Rather Questions ──
export interface WYRQuestion {
	option1: string;
	option2: string;
}

export const WYR_QUESTIONS: WYRQuestion[] = [
	{ option1: 'have a personal chef', option2: 'have a personal chauffeur' },
	{ option1: 'always be 10 minutes late', option2: 'always be 20 minutes early' },
	{ option1: 'live without music', option2: 'live without television' },
	{ option1: 'have superpower of flight', option2: 'have superpower of invisibility' },
	{ option1: 'be able to speak all languages', option2: 'be able to speak to animals' },
	{ option1: 'always have to sing instead of speaking', option2: 'always have to dance everywhere you go' },
	{ option1: 'know the date of your death', option2: 'know the cause of your death' },
	{ option1: 'live in the ocean', option2: 'live in space' },
	{ option1: 'always be slightly too hot', option2: 'always be slightly too cold' },
	{ option1: 'have your dreams documented on video', option2: 'have your thoughts broadcasted live' },
	{ option1: 'fight 1 horse-sized duck', option2: 'fight 100 duck-sized horses' },
	{ option1: 'only eat pizza for the rest of your life', option2: 'only eat tacos for the rest of your life' },
	{ option1: 'be a genius in a world of fools', option2: 'be a fool in a world of geniuses' },
	{ option1: 'have a rewind button for your life', option2: 'have a pause button for your life' },
	{ option1: 'be able to read minds', option2: 'be able to predict the future' },
	{ option1: 'never use a social media app again', option2: 'never watch a movie/show again' },
];

export function getRandomWYR(): WYRQuestion {
	return WYR_QUESTIONS[Math.floor(Math.random() * WYR_QUESTIONS.length)];
}

// ── Cute Animal Helper ──
export async function fetchAnimalImage(type: string): Promise<string> {
	if (type === 'cat') {
		const res = await fetch('https://api.thecatapi.com/v1/images/search');
		const data: any = await res.json();
		return data[0]?.url || '';
	}
	if (type === 'dog') {
		const res = await fetch('https://dog.ceo/api/breeds/image/random');
		const data: any = await res.json();
		return data.message || '';
	}
	if (type === 'pikachu') {
		const pikachuGifs = [
			'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExM3Y5dzR2ZzFjNGN4Y29wMXQxZ2k2cDB3bW1wZHJ3c3g5NDBpNXg4YSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/U2nN0ridM4TCnMLD6u/giphy.gif',
			'https://media.giphy.com/media/xx0J3vA15TkiA/giphy.gif',
			'https://media.giphy.com/media/slVWEctHZKvWU/giphy.gif',
			'https://media.giphy.com/media/yG0hbadRLI9Yk/giphy.gif',
		];
		const r = Math.random();
		if (r < 0.1) {
			return pikachuGifs[Math.floor(Math.random() * pikachuGifs.length)];
		}
		try {
			const res = await fetch('https://pokeapi.co/api/v2/pokemon/pikachu');
			const data: any = await res.json();
			if (r < 0.2) {
				return (
					data.sprites?.other?.['official-artwork']?.front_shiny ||
					data.sprites?.other?.['official-artwork']?.front_default ||
					''
				);
			}
			return data.sprites?.other?.['official-artwork']?.front_default || '';
		} catch {
			return pikachuGifs[0];
		}
	}

	const apiKeys: Record<string, string> = {
		fox: 'fox',
		panda: 'panda',
		redpanda: 'red_panda',
		koala: 'koala',
		bird: 'birb',
		raccoon: 'raccoon',
		kangaroo: 'kangaroo',
	};
	const key = apiKeys[type] || type;
	const res = await fetch(`https://some-random-api.com/img/${key}`);
	const data: any = await res.json();
	return data.link || '';
}
