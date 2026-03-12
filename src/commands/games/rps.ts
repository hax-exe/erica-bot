import {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    User,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { gameManager, RPSSession } from '../../services/gameManager.js';
import {
    renderChallengeButtons,
    createChallengeEmbed,
    validateChallengeStart,
    scheduleChallengeTimeout,
    registerGameUI,
} from './gameUtils.js';

const CHOICE_EMOJIS: { [key: string]: string } = {
    rock: '🪨',
    paper: '📄',
    scissors: '✂️',
};

/**
 * Render the RPS choice buttons
 * Buttons stay enabled for all players - validation happens in button handler
 */
function renderButtons(game: RPSSession): ActionRowBuilder<ButtonBuilder>[] {
    const row = new ActionRowBuilder<ButtonBuilder>();

    const choices = ['rock', 'paper', 'scissors'] as const;

    for (const choice of choices) {
        const button = new ButtonBuilder()
            .setCustomId(`game_rps_${game.id}_${choice}`)
            .setEmoji(CHOICE_EMOJIS[choice]!)
            .setLabel(choice.charAt(0).toUpperCase() + choice.slice(1))
            .setStyle(ButtonStyle.Primary)
            .setDisabled(game.status !== 'active');

        row.addComponents(button);
    }

    return [row];
}

/**
 * Create the game embed
 */
function createGameEmbed(
    game: RPSSession,
    player1: User,
    player2: User,
    result?: {
        winner?: string | null;
        isDraw?: boolean;
        choices?: { [playerId: string]: string };
        declined?: boolean;
    }
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle('🎮 Rock Paper Scissors')
        .setColor(result?.winner ? 0x57f287 : result?.isDraw ? 0xfee75c : result?.declined ? 0xed4245 : 0x5865f2);

    if (result?.declined) {
        embed.setDescription('❌ **Challenge declined.**');
        embed.addFields(
            {
                name: 'Challenger',
                value: `${game.playerSymbols[player1.id]} ${player1}`,
                inline: true,
            },
            {
                name: 'Opponent',
                value: `${game.playerSymbols[player2.id]} ${player2}`,
                inline: true,
            }
        );
    } else if (result && result.choices) {
        // Game finished - show results
        const c1 = result.choices[player1.id]!;
        const c2 = result.choices[player2.id]!;

        embed.addFields(
            {
                name: player1.displayName,
                value: `${CHOICE_EMOJIS[c1]} ${c1.toUpperCase()}`,
                inline: true,
            },
            {
                name: 'VS',
                value: '⚔️',
                inline: true,
            },
            {
                name: player2.displayName,
                value: `${CHOICE_EMOJIS[c2]} ${c2.toUpperCase()}`,
                inline: true,
            }
        );

        if (result.isDraw) {
            embed.setDescription("🤝 **It's a draw!**");
        } else if (result.winner) {
            const winner = result.winner === player1.id ? player1 : player2;
            embed.setDescription(`🎉 **${winner} wins!**`);
        }
    } else {
        // Game in progress
        const p1Status = game.choices[player1.id] ? '✅ Chosen' : '⏳ Choosing...';
        const p2Status = game.choices[player2.id] ? '✅ Chosen' : '⏳ Choosing...';

        embed.addFields(
            {
                name: player1.displayName,
                value: p1Status,
                inline: true,
            },
            {
                name: 'VS',
                value: '⚔️',
                inline: true,
            },
            {
                name: player2.displayName,
                value: p2Status,
                inline: true,
            }
        );

        embed.setDescription('Both players, make your choice!');
    }

    embed.setTimestamp();

    return embed;
}

// Register UI adapter for the accept/decline button handler
registerGameUI('rps', {
    createActivePayload(game, player1, player2) {
        const typedGame = game as RPSSession;
        const embed = createGameEmbed(typedGame, player1, player2);
        const components = renderButtons(typedGame);
        return {
            content: 'Game started! Both players, make your choice!',
            embeds: [embed],
            components,
        };
    },
    createDeclinedPayload(game, player1, player2) {
        const typedGame = game as RPSSession;
        const embed = createGameEmbed(typedGame, player1, player2, { declined: true });
        return {
            content: `${player2} declined the challenge.`,
            embeds: [embed],
            components: [],
        };
    },
});

export default new Command({
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Challenge someone to Rock Paper Scissors')
        .addUserOption((option) =>
            option
                .setName('opponent')
                .setDescription('The user you want to challenge')
                .setRequired(true)
        ),
    category: 'games',
    cooldown: 3,
    guildOnly: true,

    async execute(interaction) {
        const opponent = interaction.options.getUser('opponent', true);
        const challenger = interaction.user;

        // Shared validation
        const valid = await validateChallengeStart(interaction, opponent);
        if (!valid) return;

        // Create the game (starts in pending state)
        const game = gameManager.createRPS(
            challenger.id,
            opponent.id,
            interaction.channelId
        );

        const embed = createChallengeEmbed({
            gameName: 'Rock Paper Scissors',
            challenger,
            opponent,
            playerSymbols: game.playerSymbols,
        });
        const components = renderChallengeButtons(game.id);

        // Send ephemeral confirmation to challenger
        await interaction.reply({
            content: `✅ Challenge sent to ${opponent}! Waiting for them to accept...`,
            ephemeral: true,
        });

        // Send challenge message to channel for opponent
        const channel = interaction.channel;
        if (!channel || !('send' in channel)) return;

        const challengeMessage = await channel.send({
            content: `${opponent}, you've been challenged to Rock Paper Scissors by ${challenger}!`,
            embeds: [embed],
            components,
        });

        // Store the message ID for updates
        gameManager.setMessageId(game.id, challengeMessage.id);

        // Schedule pending challenge timeout
        scheduleChallengeTimeout({
            gameId: game.id,
            challengeMessage,
            createTimeoutEmbed: () => {
                const timeoutEmbed = createGameEmbed(game, challenger, opponent, { declined: false });
                timeoutEmbed.setDescription('⏰ **Challenge timed out.**');
                timeoutEmbed.setColor(0x95a5a6);
                return timeoutEmbed;
            },
        });
    },
});

// Export helper functions for use in button handler
export { renderButtons, createGameEmbed, CHOICE_EMOJIS };
