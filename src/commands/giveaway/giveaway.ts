import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    TextChannel,
    ChannelType,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { giveaways } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Manage giveaways')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('start')
                .setDescription('Start a new giveaway')
                .addStringOption((option) =>
                    option
                        .setName('prize')
                        .setDescription('What you\'re giving away')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('duration')
                        .setDescription('How long the giveaway lasts (e.g., 1h, 1d, 7d)')
                        .setRequired(true)
                )
                .addIntegerOption((option) =>
                    option
                        .setName('winners')
                        .setDescription('Number of winners')
                        .setMinValue(1)
                        .setMaxValue(20)
                )
                .addChannelOption((option) =>
                    option
                        .setName('channel')
                        .setDescription('Channel to host the giveaway (defaults to current)')
                        .addChannelTypes(ChannelType.GuildText)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('end')
                .setDescription('End a giveaway early')
                .addStringOption((option) =>
                    option
                        .setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('reroll')
                .setDescription('Reroll winners for a giveaway')
                .addStringOption((option) =>
                    option
                        .setName('message_id')
                        .setDescription('Message ID of the giveaway')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'giveaway',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'start') {
            await handleStart(interaction);
        } else if (subcommand === 'end') {
            await handleEnd(interaction);
        } else if (subcommand === 'reroll') {
            await handleReroll(interaction);
        }
    },
});

async function handleStart(interaction: any): Promise<void> {
    const prize = interaction.options.getString('prize', true);
    const durationStr = interaction.options.getString('duration', true);
    const winnersCount = interaction.options.getInteger('winners') || 1;
    const channel = (interaction.options.getChannel('channel') || interaction.channel) as TextChannel;

    // Parse duration
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
        await interaction.reply({
            content: '❌ Invalid duration. Use formats like: 1h, 1d, 7d',
            ephemeral: true,
        });
        return;
    }

    const endsAt = new Date(Date.now() + durationMs);

    // Create the giveaway embed
    const embed = new EmbedBuilder()
        .setColor(0xff69b4)
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`**${prize}**\n\nReact with 🎉 to enter!\n\n⏰ Ends: <t:${Math.floor(endsAt.getTime() / 1000)}:R>`)
        .addFields(
            { name: 'Winners', value: `${winnersCount}`, inline: true },
            { name: 'Hosted by', value: `${interaction.user}`, inline: true },
        )
        .setFooter({ text: 'Click the button below to enter!' })
        .setTimestamp(endsAt);

    const button = new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel('Enter Giveaway')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    // Send the giveaway message
    const message = await channel.send({ embeds: [embed], components: [row] });

    // Save to database
    await db.insert(giveaways).values({
        guildId: interaction.guildId!,
        channelId: channel.id,
        messageId: message.id,
        hostId: interaction.user.id,
        prize,
        winnersCount,
        endsAt,
        entries: [],
        winners: [],
        ended: false,
    });

    await interaction.reply({
        content: `✅ Giveaway started in ${channel}!`,
        ephemeral: true,
    });
}

async function handleEnd(interaction: any): Promise<void> {
    const messageId = interaction.options.getString('message_id', true);

    // Find the giveaway
    const giveaway = await db.query.giveaways.findFirst({
        where: (g, { eq, and }) => and(
            eq(g.guildId, interaction.guildId!),
            eq(g.messageId, messageId)
        ),
    });

    if (!giveaway) {
        await interaction.reply({
            content: '❌ Giveaway not found.',
            ephemeral: true,
        });
        return;
    }

    if (giveaway.ended) {
        await interaction.reply({
            content: '❌ This giveaway has already ended.',
            ephemeral: true,
        });
        return;
    }

    // End the giveaway
    await endGiveaway(interaction.client, giveaway);

    await interaction.reply({
        content: '✅ Giveaway ended!',
        ephemeral: true,
    });
}

async function handleReroll(interaction: any): Promise<void> {
    const messageId = interaction.options.getString('message_id', true);

    // Find the giveaway
    const giveaway = await db.query.giveaways.findFirst({
        where: (g, { eq, and }) => and(
            eq(g.guildId, interaction.guildId!),
            eq(g.messageId, messageId)
        ),
    });

    if (!giveaway) {
        await interaction.reply({
            content: '❌ Giveaway not found.',
            ephemeral: true,
        });
        return;
    }

    if (!giveaway.ended) {
        await interaction.reply({
            content: '❌ This giveaway hasn\'t ended yet.',
            ephemeral: true,
        });
        return;
    }

    const entries = giveaway.entries || [];
    if (entries.length === 0) {
        await interaction.reply({
            content: '❌ No entries in this giveaway.',
            ephemeral: true,
        });
        return;
    }

    // Pick new winner
    const newWinner = entries[Math.floor(Math.random() * entries.length)];
    const channel = interaction.guild!.channels.cache.get(giveaway.channelId) as TextChannel;

    if (channel) {
        await channel.send(`🎉 Rerolled! The new winner is <@${newWinner}>! Congratulations!`);
    }

    await interaction.reply({
        content: '✅ Rerolled winner!',
        ephemeral: true,
    });
}

async function endGiveaway(client: any, giveaway: any): Promise<void> {
    const entries = giveaway.entries || [];
    const winnersCount = giveaway.winnersCount;

    // Select winners
    const winners: string[] = [];
    const availableEntries = [...entries];

    for (let i = 0; i < winnersCount && availableEntries.length > 0; i++) {
        const index = Math.floor(Math.random() * availableEntries.length);
        winners.push(availableEntries.splice(index, 1)[0]!);
    }

    // Update database
    await db.update(giveaways)
        .set({ ended: true, winners })
        .where(eq(giveaways.id, giveaway.id));

    // Update the message
    const channel = client.channels.cache.get(giveaway.channelId) as TextChannel;
    if (!channel) return;

    try {
        const message = await channel.messages.fetch(giveaway.messageId);

        const embed = new EmbedBuilder()
            .setColor(0x808080)
            .setTitle('🎉 GIVEAWAY ENDED 🎉')
            .setDescription(`**${giveaway.prize}**\n\n${winners.length > 0 ? `🏆 Winner(s): ${winners.map((w: string) => `<@${w}>`).join(', ')}` : 'No valid entries'}`)
            .addFields(
                { name: 'Entries', value: `${entries.length}`, inline: true },
                { name: 'Hosted by', value: `<@${giveaway.hostId}>`, inline: true },
            )
            .setTimestamp();

        await message.edit({ embeds: [embed], components: [] });

        // Announce winners
        if (winners.length > 0) {
            await channel.send(`🎉 Congratulations ${winners.map((w: string) => `<@${w}>`).join(', ')}! You won **${giveaway.prize}**!`);
        } else {
            await channel.send('😢 No one entered the giveaway.');
        }
    } catch {
        // message deleted or channel unavailable
    }
}

function parseDuration(duration: string): number | undefined {
    const match = duration.match(/^(\d+)(m|h|d|w)$/i);
    if (!match) return undefined;

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    const multipliers: Record<string, number> = {
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000,
        w: 7 * 24 * 60 * 60 * 1000,
    };

    return value * (multipliers[unit] || 0);
}
