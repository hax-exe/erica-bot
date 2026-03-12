import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChatInputCommandInteraction,
    Message,
} from 'discord.js';
import type { User, Client } from 'discord.js';
import { gameManager } from '../../services/gameManager.js';
import type { AnyGameSession } from '../../services/gameManager.js';
import { validateMemberWithError } from '../../utils/memberValidation.js';

/**
 * Render Accept/Decline buttons for any pending game challenge.
 * Shared across all game types — button custom IDs are game-type-agnostic.
 */
export function renderChallengeButtons(gameId: string): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`game_accept_${gameId}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`game_decline_${gameId}`)
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    return [row];
}

/**
 * Create a pending challenge embed for any game type.
 */
export function createChallengeEmbed(options: {
    gameName: string;
    challenger: User;
    opponent: User;
    playerSymbols: { [playerId: string]: string };
}): EmbedBuilder {
    const { gameName, challenger, opponent, playerSymbols } = options;

    return new EmbedBuilder()
        .setTitle(`🎮 ${gameName} Challenge!`)
        .setColor(0xfee75c)
        .setDescription(`${challenger} has challenged ${opponent} to a game of ${gameName}!`)
        .addFields(
            {
                name: 'Challenger',
                value: `${playerSymbols[challenger.id]} ${challenger}`,
                inline: true,
            },
            {
                name: 'Opponent',
                value: `${playerSymbols[opponent.id]} ${opponent}`,
                inline: true,
            }
        )
        .setFooter({ text: 'Challenge expires in 1 minute' })
        .setTimestamp();
}

/**
 * Validate that a challenge can be started. Handles all error replies.
 * Returns true if validation passed, false if it failed (reply already sent).
 */
export async function validateChallengeStart(
    interaction: ChatInputCommandInteraction,
    opponent: User,
): Promise<boolean> {
    const challenger = interaction.user;

    if (opponent.id === challenger.id) {
        await interaction.reply({
            content: "❌ You can't play against yourself!",
            ephemeral: true,
        });
        return false;
    }

    if (opponent.bot) {
        await interaction.reply({
            content: "❌ You can't play against a bot!",
            ephemeral: true,
        });
        return false;
    }

    // Validate opponent is in server
    const opponentMember = await validateMemberWithError(interaction, opponent.id, opponent.tag);
    if (!opponentMember) return false;

    // Check if challenger is already in a game
    const challengerGame = gameManager.isPlayerInGame(challenger.id);
    if (challengerGame) {
        await interaction.reply({
            content: '❌ You are already in a game! Finish or wait for it to expire first.',
            ephemeral: true,
        });
        return false;
    }

    // Check if opponent is already in a game
    const opponentGame = gameManager.isPlayerInGame(opponent.id);
    if (opponentGame) {
        await interaction.reply({
            content: `❌ ${opponent} is already in a game! They need to finish or wait for it to expire.`,
            ephemeral: true,
        });
        return false;
    }

    return true;
}

/**
 * Schedule a pending-challenge timeout. After 60 seconds, if the game is
 * still pending, edits the challenge message to show timeout and cleans up.
 */
export function scheduleChallengeTimeout(options: {
    gameId: string;
    challengeMessage: Message;
    createTimeoutEmbed: () => EmbedBuilder;
}): void {
    const { gameId, challengeMessage, createTimeoutEmbed } = options;

    setTimeout(async () => {
        const currentGame = gameManager.getGame(gameId);
        // Only update if game is still pending (not accepted/declined)
        if (currentGame && currentGame.status === 'pending') {
            try {
                const timeoutEmbed = createTimeoutEmbed();
                await challengeMessage.edit({
                    content: '⏰ Challenge timed out.',
                    embeds: [timeoutEmbed],
                    components: [],
                });
                gameManager.endGame(gameId);
            } catch {
                // Message may have been deleted
            }
        }
    }, 60000);
}

/**
 * Fetch both players in a game session. Returns null if either fetch fails.
 */
export async function fetchGamePlayers(
    client: Client,
    players: [string, string],
): Promise<{ player1: User; player2: User } | null> {
    const [player1, player2] = await Promise.all([
        client.users.fetch(players[0]).catch(() => null),
        client.users.fetch(players[1]).catch(() => null),
    ]);

    if (!player1 || !player2) return null;

    return { player1, player2 };
}

/**
 * Game-specific UI adapter for the accept/decline flow in gameButtons.ts.
 * Each game type provides functions to build the active-state and declined-state
 * message payloads so the button handler doesn't need if/else chains.
 */
export interface GameUIAdapter {
    createActivePayload(
        game: AnyGameSession,
        player1: User,
        player2: User,
    ): { content: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };

    createDeclinedPayload(
        game: AnyGameSession,
        player1: User,
        player2: User,
    ): { content: string; embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] };
}

/** Registry of game-specific UI adapters, keyed by game type. */
const gameUIAdapters = new Map<string, GameUIAdapter>();

export function registerGameUI(gameType: string, adapter: GameUIAdapter): void {
    gameUIAdapters.set(gameType, adapter);
}

export function getGameUI(gameType: string): GameUIAdapter | undefined {
    return gameUIAdapters.get(gameType);
}
