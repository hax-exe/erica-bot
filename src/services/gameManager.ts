import { createLogger } from '../utils/logger.js';

const logger = createLogger('game-manager');

export type GameType = 'tictactoe' | 'connect4' | 'rps';

export interface GameSession {
    id: string;
    type: GameType;
    players: [string, string];
    playerSymbols: { [playerId: string]: string };
    currentTurn: string;
    board: string[][];
    channelId: string;
    messageId: string;
    status: 'pending' | 'active' | 'finished';
    winner: string | null;
    createdAt: Date;
    expiresAt: Date;
}

export interface RPSSession extends Omit<GameSession, 'board' | 'currentTurn'> {
    type: 'rps';
    choices: { [playerId: string]: 'rock' | 'paper' | 'scissors' | null };
}

export type AnyGameSession = GameSession | RPSSession;

class GameManager {
    private games: Map<string, AnyGameSession> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval (every minute)
        this.cleanupInterval = setInterval(() => this.cleanupExpiredGames(), 60000);
    }

    /**
     * Generate a unique game ID
     */
    private generateId(): string {
        return `game_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Create a new Tic-Tac-Toe game
     */
    createTicTacToe(
        player1Id: string,
        player2Id: string,
        channelId: string
    ): GameSession {
        const id = this.generateId();
        const game: GameSession = {
            id,
            type: 'tictactoe',
            players: [player1Id, player2Id],
            playerSymbols: {
                [player1Id]: '❌',
                [player2Id]: '⭕',
            },
            currentTurn: player1Id,
            board: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
            ],
            channelId,
            messageId: '',
            status: 'pending',
            winner: null,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
        };

        this.games.set(id, game);
        logger.debug({ gameId: id, players: game.players }, 'Created Tic-Tac-Toe game');
        return game;
    }

    /**
     * Create a new Connect Four game
     */
    createConnectFour(
        player1Id: string,
        player2Id: string,
        channelId: string
    ): GameSession {
        const id = this.generateId();
        // 6 rows x 7 columns
        const board: string[][] = [];
        for (let i = 0; i < 6; i++) {
            board.push(['', '', '', '', '', '', '']);
        }

        const game: GameSession = {
            id,
            type: 'connect4',
            players: [player1Id, player2Id],
            playerSymbols: {
                [player1Id]: '🔴',
                [player2Id]: '🟡',
            },
            currentTurn: player1Id,
            board,
            channelId,
            messageId: '',
            status: 'pending',
            winner: null,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
        };

        this.games.set(id, game);
        logger.debug({ gameId: id, players: game.players }, 'Created Connect Four game');
        return game;
    }

    /**
     * Create a new Rock Paper Scissors game
     */
    createRPS(
        player1Id: string,
        player2Id: string,
        channelId: string
    ): RPSSession {
        const id = this.generateId();
        const game: RPSSession = {
            id,
            type: 'rps',
            players: [player1Id, player2Id],
            playerSymbols: {
                [player1Id]: '🅰️',
                [player2Id]: '🅱️',
            },
            choices: {
                [player1Id]: null,
                [player2Id]: null,
            },
            channelId,
            messageId: '',
            status: 'pending',
            winner: null,
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 minutes
        };

        this.games.set(id, game);
        logger.debug({ gameId: id, players: game.players }, 'Created RPS game');
        return game;
    }

    /**
     * Get a game by ID
     */
    getGame(gameId: string): AnyGameSession | undefined {
        return this.games.get(gameId);
    }

    /**
     * Get a game by message ID
     */
    getGameByMessageId(messageId: string): AnyGameSession | undefined {
        for (const game of this.games.values()) {
            if (game.messageId === messageId) {
                return game;
            }
        }
        return undefined;
    }

    /**
     * Update message ID for a game
     */
    setMessageId(gameId: string, messageId: string): void {
        const game = this.games.get(gameId);
        if (game) {
            game.messageId = messageId;
        }
    }

    /**
     * Accept a pending game challenge
     */
    acceptGame(gameId: string, playerId: string): { success: boolean; error?: string } {
        const game = this.games.get(gameId);
        if (!game) {
            return { success: false, error: 'Game not found' };
        }

        if (game.status !== 'pending') {
            return { success: false, error: 'Game is not pending' };
        }

        // Only the challenged player (player 2) can accept
        if (game.players[1] !== playerId) {
            return { success: false, error: 'Only the challenged player can accept' };
        }

        game.status = 'active';
        // Extend expiration now that game is active
        if (game.type === 'tictactoe') {
            game.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        } else if (game.type === 'connect4') {
            game.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        } else {
            game.expiresAt = new Date(Date.now() + 2 * 60 * 1000);
        }

        logger.debug({ gameId, playerId }, 'Game accepted');
        return { success: true };
    }

    /**
     * Decline a pending game challenge
     */
    declineGame(gameId: string, playerId: string): { success: boolean; error?: string } {
        const game = this.games.get(gameId);
        if (!game) {
            return { success: false, error: 'Game not found' };
        }

        if (game.status !== 'pending') {
            return { success: false, error: 'Game is not pending' };
        }

        // Only the challenged player (player 2) can decline
        if (game.players[1] !== playerId) {
            return { success: false, error: 'Only the challenged player can decline' };
        }

        this.games.delete(gameId);
        logger.debug({ gameId, playerId }, 'Game declined');
        return { success: true };
    }

    /**
     * Make a move in Tic-Tac-Toe
     */
    makeTTTMove(gameId: string, playerId: string, row: number, col: number): {
        success: boolean;
        error?: string;
        winner?: string | null;
        isDraw?: boolean;
    } {
        const game = this.games.get(gameId) as GameSession | undefined;
        if (!game || game.type !== 'tictactoe') {
            return { success: false, error: 'Game not found' };
        }

        if (game.status !== 'active') {
            return { success: false, error: 'Game is not active' };
        }

        if (game.currentTurn !== playerId) {
            return { success: false, error: 'Not your turn' };
        }

        if (game.board[row]![col] !== '') {
            return { success: false, error: 'Cell already occupied' };
        }

        // Make the move
        game.board[row]![col] = game.playerSymbols[playerId]!;

        // Check for winner
        const winner = this.checkTTTWinner(game.board);
        if (winner) {
            game.status = 'finished';
            game.winner = playerId;
            return { success: true, winner: playerId };
        }

        // Check for draw
        const isDraw = game.board.every(row => row.every(cell => cell !== ''));
        if (isDraw) {
            game.status = 'finished';
            return { success: true, isDraw: true };
        }

        // Switch turns
        game.currentTurn = game.players[0] === playerId ? game.players[1] : game.players[0];

        return { success: true };
    }

    /**
     * Check for Tic-Tac-Toe winner
     */
    private checkTTTWinner(board: string[][]): string | null {
        // Check rows
        for (let i = 0; i < 3; i++) {
            if (board[i]![0] && board[i]![0] === board[i]![1] && board[i]![1] === board[i]![2]) {
                return board[i]![0]!;
            }
        }

        // Check columns
        for (let j = 0; j < 3; j++) {
            if (board[0]![j] && board[0]![j] === board[1]![j] && board[1]![j] === board[2]![j]) {
                return board[0]![j]!;
            }
        }

        // Check diagonals
        if (board[0]![0] && board[0]![0] === board[1]![1] && board[1]![1] === board[2]![2]) {
            return board[0]![0]!;
        }
        if (board[0]![2] && board[0]![2] === board[1]![1] && board[1]![1] === board[2]![0]) {
            return board[0]![2]!;
        }

        return null;
    }

    /**
     * Make a move in Connect Four
     */
    makeC4Move(gameId: string, playerId: string, column: number): {
        success: boolean;
        error?: string;
        row?: number;
        winner?: string | null;
        isDraw?: boolean;
    } {
        const game = this.games.get(gameId) as GameSession | undefined;
        if (!game || game.type !== 'connect4') {
            return { success: false, error: 'Game not found' };
        }

        if (game.status !== 'active') {
            return { success: false, error: 'Game is not active' };
        }

        if (game.currentTurn !== playerId) {
            return { success: false, error: 'Not your turn' };
        }

        // Find the lowest empty row in the column
        let targetRow = -1;
        for (let row = 5; row >= 0; row--) {
            if (game.board[row]![column] === '') {
                targetRow = row;
                break;
            }
        }

        if (targetRow === -1) {
            return { success: false, error: 'Column is full' };
        }

        // Make the move
        game.board[targetRow]![column] = game.playerSymbols[playerId]!;

        // Check for winner
        const winner = this.checkC4Winner(game.board, targetRow, column);
        if (winner) {
            game.status = 'finished';
            game.winner = playerId;
            return { success: true, row: targetRow, winner: playerId };
        }

        // Check for draw
        const isDraw = game.board[0]!.every(cell => cell !== '');
        if (isDraw) {
            game.status = 'finished';
            return { success: true, row: targetRow, isDraw: true };
        }

        // Switch turns
        game.currentTurn = game.players[0] === playerId ? game.players[1] : game.players[0];

        return { success: true, row: targetRow };
    }

    /**
     * Check for Connect Four winner
     */
    private checkC4Winner(board: string[][], row: number, col: number): boolean {
        const symbol = board[row]![col];
        if (!symbol) return false;

        const directions = [
            [[0, 1], [0, -1]],   // Horizontal
            [[1, 0], [-1, 0]],   // Vertical
            [[1, 1], [-1, -1]], // Diagonal \
            [[1, -1], [-1, 1]], // Diagonal /
        ];

        for (const direction of directions) {
            let count = 1;

            for (const [dr, dc] of direction) {
                let r = row + dr!;
                let c = col + dc!;

                while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r]![c] === symbol) {
                    count++;
                    r += dr!;
                    c += dc!;
                }
            }

            if (count >= 4) {
                return true;
            }
        }

        return false;
    }

    /**
     * Make a choice in Rock Paper Scissors
     */
    makeRPSChoice(gameId: string, playerId: string, choice: 'rock' | 'paper' | 'scissors'): {
        success: boolean;
        error?: string;
        bothChosen?: boolean;
        winner?: string | null;
        isDraw?: boolean;
        choices?: { [playerId: string]: string };
    } {
        const game = this.games.get(gameId) as RPSSession | undefined;
        if (!game || game.type !== 'rps') {
            return { success: false, error: 'Game not found' };
        }

        if (game.status !== 'active') {
            return { success: false, error: 'Game is not active' };
        }

        if (!game.players.includes(playerId)) {
            return { success: false, error: 'You are not in this game' };
        }

        if (game.choices[playerId]) {
            return { success: false, error: 'You already made a choice' };
        }

        game.choices[playerId] = choice;

        // Check if both players have chosen
        const [p1, p2] = game.players;
        if (game.choices[p1] && game.choices[p2]) {
            game.status = 'finished';

            const c1 = game.choices[p1]!;
            const c2 = game.choices[p2]!;

            // Determine winner
            if (c1 === c2) {
                return {
                    success: true,
                    bothChosen: true,
                    isDraw: true,
                    choices: { [p1]: c1, [p2]: c2 },
                };
            }

            const wins: { [key: string]: string } = {
                rock: 'scissors',
                paper: 'rock',
                scissors: 'paper',
            };

            const winner = wins[c1] === c2 ? p1 : p2;
            game.winner = winner;

            return {
                success: true,
                bothChosen: true,
                winner,
                choices: { [p1]: c1, [p2]: c2 },
            };
        }

        return { success: true, bothChosen: false };
    }

    /**
     * End a game
     */
    endGame(gameId: string): void {
        this.games.delete(gameId);
        logger.debug({ gameId }, 'Game ended');
    }

    /**
     * Clean up expired games
     */
    private cleanupExpiredGames(): void {
        const now = new Date();
        let cleaned = 0;

        for (const [id, game] of this.games) {
            if (game.expiresAt < now) {
                this.games.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug({ count: cleaned }, 'Cleaned up expired games');
        }
    }

    /**
     * Cleanup on shutdown
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.games.clear();
    }
}

// Singleton instance
export const gameManager = new GameManager();
