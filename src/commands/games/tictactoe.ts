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
        .setTitle('🎮 Tic-Tac-Toe Challenge!')
        .setColor(0xfee75c)
        .setDescription(`${challenger} has challenged ${opponent} to a game of Tic-Tac-Toe!`)
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
 * Render the Tic-Tac-Toe board as button components
 */
function renderBoard(game: GameSession): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];

    for (let i = 0; i < 3; i++) {
        const row = new ActionRowBuilder<ButtonBuilder>();

        for (let j = 0; j < 3; j++) {
            const cell = game.board[i]![j];
            const button = new ButtonBuilder()
                .setCustomId(`game_ttt_${game.id}_${i}_${j}`)
                .setStyle(cell ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setDisabled(game.status !== 'active' || cell !== '');

            if (cell) {
                button.setEmoji(cell);
            } else {
                button.setLabel('\u200b'); // Zero-width space for empty cells
            }

            row.addComponents(button);
        }

        rows.push(row);
    }

    return rows;
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
        .setTitle('🎮 Tic-Tac-Toe')
        .setColor(status === 'win' ? 0x57f287 : status === 'draw' ? 0xfee75c : status === 'declined' ? 0xed4245 : 0x5865f2)
        .addFields(
            {
                name: 'Players',
                value: `${game.playerSymbols[player1.id]} ${player1} vs ${game.playerSymbols[player2.id]} ${player2}`,
                inline: false,
            }
        );

    if (status === 'win' && game.winner) {
        const winner = game.winner === player1.id ? player1 : player2;
        embed.setDescription(`🎉 **${winner} wins!**`);
    } else if (status === 'draw') {
        embed.setDescription("🤝 **It's a draw!**");
    } else if (status === 'timeout') {
        embed.setDescription('⏰ **Game timed out!**');
    } else if (status === 'declined') {
        embed.setDescription('❌ **Challenge declined.**');
    } else {
        const currentPlayer = game.currentTurn === player1.id ? player1 : player2;
        embed.setDescription(`Current turn: ${currentPlayer}`);
    }

    embed.setTimestamp();

    return embed;
}

export default new Command({
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Challenge someone to a game of Tic-Tac-Toe')
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

        // Create the game (starts in pending state)
        const game = gameManager.createTicTacToe(
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
            content: `${opponent}, you've been challenged to Tic-Tac-Toe by ${challenger}!`,
            embeds: [embed],
            components,
        });

        // Store the message ID for updates
        gameManager.setMessageId(game.id, challengeMessage.id);
    },
});

// Export helper functions for use in button handler
export { renderBoard, createGameEmbed, renderChallengeButtons, createChallengeEmbed };

