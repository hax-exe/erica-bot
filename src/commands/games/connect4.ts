import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    User,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { gameManager, GameSession } from '../../services/gameManager.js';
import { validateMemberWithError } from '../../utils/memberValidation.js';

const COLUMN_EMOJIS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

/**
 * Render Accept/Decline buttons for pending challenge
 */
function renderChallengeButtons(game: GameSession): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`game_accept_${game.id}`)
            .setLabel('Accept')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId(`game_decline_${game.id}`)
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('❌')
    );

    return [row];
}

/**
 * Create the challenge embed (pending state)
 */
function createChallengeEmbed(
    game: GameSession,
    challenger: User,
    opponent: User
): EmbedBuilder {
    return new EmbedBuilder()
        .setTitle('🎮 Connect Four Challenge!')
        .setColor(0xfee75c)
        .setDescription(`${challenger} has challenged ${opponent} to a game of Connect Four!`)
        .addFields(
            {
                name: 'Challenger',
                value: `${game.playerSymbols[challenger.id]} ${challenger}`,
                inline: true,
            },
            {
                name: 'Opponent',
                value: `${game.playerSymbols[opponent.id]} ${opponent}`,
                inline: true,
            }
        )
        .setFooter({ text: 'Challenge expires in 1 minute' })
        .setTimestamp();
}

/**
 * Render the Connect Four board as an embed description
 */
function renderBoardText(game: GameSession): string {
    let board = '';

    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const cell = game.board[row]![col];
            board += cell || '⬛';
        }
        board += '\n';
    }

    // Column numbers at bottom
    board += COLUMN_EMOJIS.join('');

    return board;
}

/**
 * Render column selection buttons (split into two rows due to Discord's 5 button limit)
 */
function renderButtons(game: GameSession): ActionRowBuilder<ButtonBuilder>[] {
    const row1 = new ActionRowBuilder<ButtonBuilder>();
    const row2 = new ActionRowBuilder<ButtonBuilder>();

    for (let col = 0; col < 7; col++) {
        // Check if column is full
        const columnFull = game.board[0]![col] !== '';

        const button = new ButtonBuilder()
            .setCustomId(`game_c4_${game.id}_${col}`)
            .setEmoji(COLUMN_EMOJIS[col]!)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(game.status !== 'active' || columnFull);

        // First 4 buttons in row 1, remaining 3 in row 2
        if (col < 4) {
            row1.addComponents(button);
        } else {
            row2.addComponents(button);
        }
    }

    return [row1, row2];
}

/**
 * Create the game embed
 */
function createGameEmbed(
    game: GameSession,
    player1: User,
    player2: User,
    status?: 'win' | 'draw' | 'timeout' | 'declined'
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Connect Four')
        .setColor(status === 'win' ? 0x57f287 : status === 'draw' ? 0xfee75c : status === 'declined' ? 0xed4245 : 0x5865f2)
        .addFields(
            {
                name: 'Players',
                value: `${game.playerSymbols[player1.id]} ${player1} vs ${game.playerSymbols[player2.id]} ${player2}`,
                inline: false,
            }
        );

    const boardText = renderBoardText(game);

    if (status === 'win' && game.winner) {
        const winner = game.winner === player1.id ? player1 : player2;
        embed.setDescription(`${boardText}\n\n🎉 **${winner} wins!**`);
    } else if (status === 'draw') {
        embed.setDescription(`${boardText}\n\n🤝 **It's a draw!**`);
    } else if (status === 'timeout') {
        embed.setDescription(`${boardText}\n\n⏰ **Game timed out!**`);
    } else if (status === 'declined') {
        embed.setDescription('❌ **Challenge declined.**');
    } else {
        const currentPlayer = game.currentTurn === player1.id ? player1 : player2;
        embed.setDescription(`${boardText}\n\nCurrent turn: ${currentPlayer}`);
    }

    embed.setTimestamp();

    return embed;
}

export default new Command({
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Challenge someone to a game of Connect Four')
        .addUserOption((option) =>
            option
                .setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true)
        ),
    category: 'games',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const opponent = interaction.options.getUser('opponent', true);
        const challenger = interaction.user;

        // Validation
        if (opponent.id === challenger.id) {
            await interaction.reply({
                content: "❌ You can't play against yourself!",
                ephemeral: true,
            });
            return;
        }

        if (opponent.bot) {
            await interaction.reply({
                content: "❌ You can't play against a bot!",
                ephemeral: true,
            });
            return;
        }

        // Validate opponent is in server
        const opponentMember = await validateMemberWithError(interaction, opponent.id, opponent.tag);
        if (!opponentMember) return;

        // Check if challenger is already in a game
        const challengerGame = gameManager.isPlayerInGame(challenger.id);
        if (challengerGame) {
            await interaction.reply({
                content: '❌ You are already in a game! Finish or wait for it to expire first.',
                ephemeral: true,
            });
            return;
        }

        // Check if opponent is already in a game
        const opponentGame = gameManager.isPlayerInGame(opponent.id);
        if (opponentGame) {
            await interaction.reply({
                content: `❌ ${opponent} is already in a game! They need to finish or wait for it to expire.`,
                ephemeral: true,
            });
            return;
        }

        // Create the game (starts in pending state)
        const game = gameManager.createConnectFour(
            challenger.id,
            opponent.id,
            interaction.channelId
        );

        const embed = createChallengeEmbed(game, challenger, opponent);
        const components = renderChallengeButtons(game);

        // Send ephemeral confirmation to challenger
        await interaction.reply({
            content: `✅ Challenge sent to ${opponent}! Waiting for them to accept...`,
            ephemeral: true,
        });

        // Send challenge message to channel for opponent
        const channel = interaction.channel;
        if (!channel || !('send' in channel)) return;

        const challengeMessage = await channel.send({
            content: `${opponent}, you've been challenged to Connect Four by ${challenger}!`,
            embeds: [embed],
            components,
        });

        // Store the message ID for updates
        gameManager.setMessageId(game.id, challengeMessage.id);

        // Set timeout to update message if challenge expires (1 minute for pending)
        setTimeout(async () => {
            const currentGame = gameManager.getGame(game.id);
            // Only update if game is still pending (not accepted/declined)
            if (currentGame && currentGame.status === 'pending') {
                try {
                    const timeoutEmbed = createGameEmbed(currentGame as GameSession, challenger, opponent, 'timeout');
                    await challengeMessage.edit({
                        content: '⏰ Challenge timed out.',
                        embeds: [timeoutEmbed],
                        components: [],
                    });
                    gameManager.endGame(game.id);
                } catch {
                    // Message may have been deleted
                }
            }
        }, 60000); // 1 minute timeout for pending challenges
    },
});

// Export helper functions for use in button handler
export { renderBoardText, renderButtons, createGameEmbed, renderChallengeButtons, createChallengeEmbed };

