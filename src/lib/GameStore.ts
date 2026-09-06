import type { BjCard } from './BlackjackUtil.js';

export interface PendingGame {
	challengerId: string;
	targetId: string;
	guildId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface C4Game {
	board: number[][]; // 6 rows × 7 cols, 0=empty 1=P1 2=P2
	players: [string, string]; // [challengerId, targetId]
	currentTurn: 0 | 1;
	guildId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface TTTGame {
	board: number[]; // 9 cells, 0=empty 1=P1(X) 2=P2(O)
	players: [string, string];
	currentTurn: 0 | 1;
	guildId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface TriviaGame {
	correct: string;
	answers: string[];
	userId: string;
	guildId: string;
	answered: boolean;
	timeout: ReturnType<typeof setTimeout>;
}

export interface RPSGame {
	players: [string, string];
	choices: [string | null, string | null]; // P1, P2
	guildId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface StorySession {
	words: string[];
	lastUserId: string | null;
	startedById: string;
	guildId: string;
	channelId: string;
	topic: string | null;
	headerMessageId: string;
}

export interface WYRGame {
	option1: Set<string>;
	option2: Set<string>;
	option1Text: string;
	option2Text: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface Game2048 {
	board: number[][]; // 4x4 matrix
	score: number;
	userId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface FindTheEmojiGame {
	commonEmoji: string;
	oddEmoji: string;
	oddIdx: number; // 0-8 winning index
	/** Host who started the race (informational). */
	hostId: string;
	/** Players who already guessed wrong — locked out until round ends. */
	wrongGuessers: Set<string>;
	timeout: ReturnType<typeof setTimeout>;
}

export interface WordleGame {
	word: string; // 5-letter target word
	guesses: string[]; // array of 5-letter guesses
	userId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface HangmanGame {
	word: string;
	guesses: string[]; // guessed letters
	wrongCount: number;
	userId: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface NHIEGame {
	optionHave: Set<string>;
	optionNever: Set<string>;
	prompt: string;
	timeout: ReturnType<typeof setTimeout>;
}

export interface FunBlackjackGame {
	deck: BjCard[];
	playerHand: BjCard[];
	dealerHand: BjCard[];
	userId: string;
	guildId: string;
	timeout: ReturnType<typeof setTimeout>;
}

/**
 * Survive Bun `--watch` / HMR reloads. Module-level Maps are wiped when the
 * module is re-evaluated, which made every active game button fail with
 * "game has ended or does not exist" after a file save.
 */
type GameMaps = {
	pendingGames: Map<string, PendingGame & { type: 'c4' | 'ttt' | 'rps' }>;
	c4Games: Map<string, C4Game>;
	tttGames: Map<string, TTTGame>;
	rpsGames: Map<string, RPSGame>;
	triviaGames: Map<string, TriviaGame>;
	wyrGames: Map<string, WYRGame>;
	storySessions: Map<string, StorySession>;
	games2048: Map<string, Game2048>;
	findTheEmojiGames: Map<string, FindTheEmojiGame>;
	wordleGames: Map<string, WordleGame>;
	hangmanGames: Map<string, HangmanGame>;
	nhieGames: Map<string, NHIEGame>;
	funBlackjackGames: Map<string, FunBlackjackGame>;
};

const g = globalThis as typeof globalThis & { __ericaGameMaps?: GameMaps };

function maps(): GameMaps {
	if (!g.__ericaGameMaps) {
		g.__ericaGameMaps = {
			pendingGames: new Map(),
			c4Games: new Map(),
			tttGames: new Map(),
			rpsGames: new Map(),
			triviaGames: new Map(),
			wyrGames: new Map(),
			storySessions: new Map(),
			games2048: new Map(),
			findTheEmojiGames: new Map(),
			wordleGames: new Map(),
			hangmanGames: new Map(),
			nhieGames: new Map(),
			funBlackjackGames: new Map(),
		};
	}
	return g.__ericaGameMaps;
}

const m = maps();

export const pendingGames = m.pendingGames;
export const c4Games = m.c4Games;
export const tttGames = m.tttGames;
export const rpsGames = m.rpsGames;
export const triviaGames = m.triviaGames;
export const wyrGames = m.wyrGames;
export const storySessions = m.storySessions;
export const games2048 = m.games2048;
export const findTheEmojiGames = m.findTheEmojiGames;
export const wordleGames = m.wordleGames;
export const hangmanGames = m.hangmanGames;
export const nhieGames = m.nhieGames;
export const funBlackjackGames = m.funBlackjackGames;

/** Look up a game by message id and/or custom-id token; re-keys to message id when found. */
export function resolveGame<T>(
	store: Map<string, T>,
	messageId: string,
	...aliases: Array<string | undefined>
): { game: T; key: string } | null {
	const keys = [messageId, ...aliases.filter((k): k is string => Boolean(k && k !== messageId))];
	for (const key of keys) {
		const game = store.get(key);
		if (game) {
			if (key !== messageId) {
				store.set(messageId, game);
				store.delete(key);
			}
			return { game, key: messageId };
		}
	}
	return null;
}

export function isStaleInteractionError(err: unknown): boolean {
	if (typeof err !== 'object' || err === null) return false;
	const code = (err as { code?: unknown }).code;
	return code === 10062 || code === 10015 || code === 40060 || code === 10008 || code === 10003;
}
