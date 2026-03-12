import { Events, ButtonInteraction } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { gameManager, GameSession, RPSSession } from '../services/gameManager.js';
import { fetchGamePlayers, getGameUI } from '../commands/games/gameUtils.js';
import {
    renderBoard as renderTTTBoard,
    createGameEmbed as createTTTEmbed,
} from '../commands/games/tictactoe.js';
import {
    renderButtons as renderC4Buttons,
    createGameEmbed as createC4Embed,
} from '../commands/games/connect4.js';
import {
    renderButtons as renderRPSButtons,
    createGameEmbed as createRPSEmbed,
    CHOICE_EMOJIS,
} from '../commands/games/rps.js';

const logger = createLogger('game-buttons');

export default new Event({
    name: Events.InteractionCreate,

    async execute(_client, interaction) {
        if (!interaction.isButton()) return;

        const customId = interaction.customId;

        // Handle Accept/Decline challenge buttons
        if (customId.startsWith('game_accept_')) {
            await handleAccept(interaction);
            return;
        }

        if (customId.startsWith('game_decline_')) {
            await handleDecline(interaction);
            return;
        }

        // Handle Tic-Tac-Toe moves
        if (customId.startsWith('game_ttt_')) {
            await handleTicTacToe(interaction);
            return;
        }

        // Handle Connect Four moves
        if (customId.startsWith('game_c4_')) {
            await handleConnectFour(interaction);
            return;
        }

        // Handle Rock Paper Scissors choices
        if (customId.startsWith('game_rps_')) {
            await handleRPS(interaction);
            return;
        }
    },
});

async function handleAccept(interaction: ButtonInteraction): Promise<void> {
    const gameId = interaction.customId.replace('game_accept_', '');
    const game = gameManager.getGame(gameId);

    if (!game) {
        await interaction.reply({
            content: '❌ This game no longer exists.',
            ephemeral: true,
        });
        return;
    }

    const playerId = interaction.user.id;

    // Accept the game
    const result = gameManager.acceptGame(gameId, playerId);

    if (!result.success) {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true,
        });
        return;
    }

    // Fetch both players
    const players = await fetchGamePlayers(interaction.client, game.players);

    if (!players) {
        await interaction.reply({
            content: '❌ Could not fetch player information.',
            ephemeral: true,
        });
        return;
    }

    const { player1, player2 } = players;

    // Use registry to build the active-state payload
    const adapter = getGameUI(game.type);
    if (adapter) {
        const payload = adapter.createActivePayload(game, player1, player2);
        await interaction.update(payload);
    }

    logger.debug({ gameId, playerId }, 'Game accepted via button');
}

async function handleDecline(interaction: ButtonInteraction): Promise<void> {
    const gameId = interaction.customId.replace('game_decline_', '');
    const game = gameManager.getGame(gameId);

    if (!game) {
        await interaction.reply({
            content: '❌ This game no longer exists.',
            ephemeral: true,
        });
        return;
    }

    const playerId = interaction.user.id;

    // Decline the game
    const result = gameManager.declineGame(gameId, playerId);

    if (!result.success) {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true,
        });
        return;
    }

    // Fetch both players
    const players = await fetchGamePlayers(interaction.client, game.players);

    if (!players) {
        await interaction.update({
            content: '❌ Challenge declined.',
            embeds: [],
            components: [],
        });
        return;
    }

    const { player1, player2 } = players;

    // Use registry to build the declined-state payload
    const adapter = getGameUI(game.type);
    if (adapter) {
        const payload = adapter.createDeclinedPayload(game, player1, player2);
        await interaction.update(payload);
    } else {
        // Fallback if no adapter registered
        await interaction.update({
            content: '❌ Challenge declined.',
            embeds: [],
            components: [],
        });
    }

    logger.debug({ gameId, playerId }, 'Game declined via button');
}


async function handleTicTacToe(interaction: ButtonInteraction): Promise<void> {
    // Parse: game_ttt_{gameId}_{row}_{col}
    const parts = interaction.customId.split('_');
    const gameId = parts.slice(2, -2).join('_');
    const row = parseInt(parts[parts.length - 2]!, 10);
    const col = parseInt(parts[parts.length - 1]!, 10);

    const game = gameManager.getGame(gameId) as GameSession | undefined;
    if (!game || game.type !== 'tictactoe') {
        await interaction.reply({
            content: '❌ This game no longer exists.',
            ephemeral: true,
        });
        return;
    }

    const playerId = interaction.user.id;

    // Check if user is a player in this game
    if (!game.players.includes(playerId)) {
        await interaction.reply({
            content: "❌ You're not a player in this game!",
            ephemeral: true,
        });
        return;
    }

    // Make the move
    const result = gameManager.makeTTTMove(gameId, playerId, row, col);

    if (!result.success) {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true,
        });
        return;
    }

    // Fetch both players for embed
    const players = await fetchGamePlayers(interaction.client, game.players);

    if (!players) {
        await interaction.reply({
            content: '❌ Could not fetch player information.',
            ephemeral: true,
        });
        return;
    }

    const { player1, player2 } = players;

    // Determine game status
    let status: 'win' | 'draw' | undefined;
    if (result.winner) {
        status = 'win';
    } else if (result.isDraw) {
        status = 'draw';
    }

    const embed = createTTTEmbed(game, player1, player2, status);
    const components = renderTTTBoard(game);

    await interaction.update({
        embeds: [embed],
        components,
    });

    // Clean up finished game after a delay
    if (status) {
        setTimeout(() => gameManager.endGame(gameId), 60000);
    }
}

async function handleConnectFour(interaction: ButtonInteraction): Promise<void> {
    // Parse: game_c4_{gameId}_{col}
    const parts = interaction.customId.split('_');
    const column = parseInt(parts[parts.length - 1]!, 10);
    const gameId = parts.slice(2, -1).join('_');

    const game = gameManager.getGame(gameId) as GameSession | undefined;
    if (!game || game.type !== 'connect4') {
        await interaction.reply({
            content: '❌ This game no longer exists.',
            ephemeral: true,
        });
        return;
    }

    const playerId = interaction.user.id;

    // Check if user is a player in this game
    if (!game.players.includes(playerId)) {
        await interaction.reply({
            content: "❌ You're not a player in this game!",
            ephemeral: true,
        });
        return;
    }

    // Make the move
    const result = gameManager.makeC4Move(gameId, playerId, column);

    if (!result.success) {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true,
        });
        return;
    }

    // Fetch both players for embed
    const players = await fetchGamePlayers(interaction.client, game.players);

    if (!players) {
        await interaction.reply({
            content: '❌ Could not fetch player information.',
            ephemeral: true,
        });
        return;
    }

    const { player1, player2 } = players;

    // Determine game status
    let status: 'win' | 'draw' | undefined;
    if (result.winner) {
        status = 'win';
    } else if (result.isDraw) {
        status = 'draw';
    }

    const embed = createC4Embed(game, player1, player2, status);
    const components = renderC4Buttons(game);

    await interaction.update({
        embeds: [embed],
        components,
    });

    // Clean up finished game after a delay
    if (status) {
        setTimeout(() => gameManager.endGame(gameId), 60000);
    }
}

async function handleRPS(interaction: ButtonInteraction): Promise<void> {
    // Parse: game_rps_{gameId}_{choice}
    const parts = interaction.customId.split('_');
    const choice = parts[parts.length - 1] as 'rock' | 'paper' | 'scissors';
    const gameId = parts.slice(2, -1).join('_');

    const game = gameManager.getGame(gameId) as RPSSession | undefined;
    if (!game || game.type !== 'rps') {
        await interaction.reply({
            content: '❌ This game no longer exists.',
            ephemeral: true,
        });
        return;
    }

    const playerId = interaction.user.id;

    // Check if user is a player in this game
    if (!game.players.includes(playerId)) {
        await interaction.reply({
            content: "❌ You're not a player in this game!",
            ephemeral: true,
        });
        return;
    }

    // Make the choice
    const result = gameManager.makeRPSChoice(gameId, playerId, choice);

    if (!result.success) {
        await interaction.reply({
            content: `❌ ${result.error}`,
            ephemeral: true,
        });
        return;
    }

    // Fetch both players for embed
    const players = await fetchGamePlayers(interaction.client, game.players);

    if (!players) {
        await interaction.reply({
            content: '❌ Could not fetch player information.',
            ephemeral: true,
        });
        return;
    }

    const { player1, player2 } = players;

    if (result.bothChosen) {
        // Both players have chosen - reveal results
        const resultData: { winner?: string | null; isDraw?: boolean; choices?: { [playerId: string]: string } } = {};
        if (result.winner !== undefined) resultData.winner = result.winner;
        if (result.isDraw !== undefined) resultData.isDraw = result.isDraw;
        if (result.choices !== undefined) resultData.choices = result.choices;

        const embed = createRPSEmbed(game, player1, player2, resultData);

        await interaction.update({
            embeds: [embed],
            components: [], // Remove buttons
        });

        // Clean up finished game after a delay
        setTimeout(() => gameManager.endGame(gameId), 60000);
    } else {
        // Only one player has chosen - acknowledge secretly
        await interaction.reply({
            content: `You chose ${CHOICE_EMOJIS[choice]} **${choice.toUpperCase()}**! Waiting for your opponent...`,
            ephemeral: true,
        });

        // Update the embed to show this player has chosen
        const embed = createRPSEmbed(game, player1, player2);

        try {
            await interaction.message.edit({
                embeds: [embed],
                components: renderRPSButtons(game),
            });
        } catch {
            // Message may have been deleted
        }
    }
}
