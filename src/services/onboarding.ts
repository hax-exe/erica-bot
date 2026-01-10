import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Guild,
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits,
    ComponentType,
    type Message,
    type ButtonInteraction,
    type StringSelectMenuInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { ExtendedClient } from '../structures/index.js';
import { createLogger } from '../utils/logger.js';
import { db } from '../db/index.js';
import { guilds, moderationSettings, levelingSettings } from '../db/schema/index.js';
import { invalidateGuildCache } from './settingsCache.js';

const logger = createLogger('onboarding');

const BUTTON_IDS = {
    QUICK_SETUP: 'onboarding:quick_setup',
    SKIP: 'onboarding:skip',
    DOCS: 'onboarding:docs',
} as const;

/**
 * Sends the onboarding DM to the server owner when the bot joins a new guild.
 */
export async function sendOnboardingMessage(client: ExtendedClient, guild: Guild): Promise<void> {
    try {
        const owner = await guild.fetchOwner();

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('👋 Thanks for adding me!')
            .setDescription(
                `Hey **${owner.user.username}**! I'm **${client.user?.username}**, and I just joined **${guild.name}**.\n\n` +
                `I'm packed with features to help manage and entertain your community:\n\n` +
                `🛡️ **Moderation** — Warnings, bans, auto-mod\n` +
                `🎵 **Music** — High-quality playback with queues\n` +
                `📊 **Leveling** — XP, ranks, and role rewards\n` +
                `💰 **Economy** — Currency, shop, and games\n\n` +
                `Let's get you set up! Click **Quick Setup** to configure the essentials, or **Skip** if you'd like to do it later.`
            )
            .setThumbnail(client.user?.displayAvatarURL() ?? null)
            .setFooter({ text: `Server: ${guild.name}` })
            .setTimestamp();

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId(`${BUTTON_IDS.QUICK_SETUP}:${guild.id}`)
                .setLabel('Quick Setup')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('⚙️'),
            new ButtonBuilder()
                .setCustomId(`${BUTTON_IDS.SKIP}:${guild.id}`)
                .setLabel('Skip for Now')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setLabel('Documentation')
                .setStyle(ButtonStyle.Link)
                .setURL('https://github.com/hax-exe/erica-bot#readme')
                .setEmoji('📖'),
        );

        const dmChannel = await owner.createDM();
        const message = await dmChannel.send({ embeds: [embed], components: [row] });

        // Set up collector for button interactions (15 minute timeout)
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 15 * 60 * 1000,
        });

        collector.on('collect', async (interaction: ButtonInteraction) => {
            await handleOnboardingButton(interaction, client, guild, message);
        });

        collector.on('end', async (_, reason) => {
            if (reason === 'time') {
                // Disable buttons after timeout
                const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId('disabled_setup')
                        .setLabel('Quick Setup')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('⚙️')
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId('disabled_skip')
                        .setLabel('Skip for Now')
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setLabel('Documentation')
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://github.com/hax-exe/erica-bot#readme')
                        .setEmoji('📖'),
                );
                await message.edit({ components: [disabledRow] }).catch(() => { });
            }
        });

        logger.info({ guildId: guild.id, ownerId: owner.id }, 'Sent onboarding DM to server owner');
    } catch (error) {
        // Owner might have DMs disabled
        logger.warn({ error, guildId: guild.id }, 'Failed to send onboarding DM to server owner');
    }
}

/**
 * Handles button clicks from the onboarding message.
 */
async function handleOnboardingButton(
    interaction: ButtonInteraction,
    client: ExtendedClient,
    guild: Guild,
    message: Message
): Promise<void> {
    const [, action, guildId] = interaction.customId.split(':');

    if (guildId !== guild.id) return;

    if (action === 'quick_setup') {
        await startQuickSetup(interaction, client, guild, message);
    } else if (action === 'skip') {
        await markOnboardingComplete(guild.id);

        const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle('✅ Setup Skipped')
            .setDescription(
                `No problem! You can configure settings anytime using:\n\n` +
                `• \`/settings\` — Module toggles and general settings\n` +
                `• \`/moderation config\` — Moderation settings\n` +
                `• \`/leveling config\` — Leveling settings\n\n` +
                `Enjoy using the bot!`
            )
            .setTimestamp();

        await interaction.update({ embeds: [embed], components: [] });
    }
}

/**
 * Starts the quick setup wizard.
 */
async function startQuickSetup(
    interaction: ButtonInteraction,
    client: ExtendedClient,
    guild: Guild,
    message: Message
): Promise<void> {
    // Step 1: Module selection
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Quick Setup — Step 1/3')
        .setDescription(
            `**Which modules would you like to enable?**\n\n` +
            `All modules are enabled by default. Use the menu below to toggle them.\n\n` +
            `• 🛡️ **Moderation** — Warnings, bans, auto-mod\n` +
            `• 🎵 **Music** — High-quality playback\n` +
            `• 📊 **Leveling** — XP and rank system\n` +
            `• 💰 **Economy** — Currency and games`
        )
        .setFooter({ text: 'Select modules to disable, or click Continue to keep all enabled' });

    const moduleMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`onboarding:modules:${guild.id}`)
            .setPlaceholder('Select modules to disable...')
            .setMinValues(0)
            .setMaxValues(4)
            .addOptions([
                { label: 'Moderation', value: 'moderation', emoji: '🛡️' },
                { label: 'Music', value: 'music', emoji: '🎵' },
                { label: 'Leveling', value: 'leveling', emoji: '📊' },
                { label: 'Economy', value: 'economy', emoji: '💰' },
            ])
    );

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`onboarding:modules_continue:${guild.id}`)
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [embed], components: [moduleMenu, buttonRow] });

    // Collect module selections and continue button
    const collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000,
    });

    let disabledModules: string[] = [];

    collector.on('collect', async (i) => {
        if (i.isStringSelectMenu() && i.customId === `onboarding:modules:${guild.id}`) {
            disabledModules = i.values;
            await i.deferUpdate();
        } else if (i.isButton() && i.customId === `onboarding:modules_continue:${guild.id}`) {
            collector.stop('continue');
            await handleModLogStep(i as ButtonInteraction, client, guild, message, disabledModules);
        }
    });
}

/**
 * Step 2: Mod log channel selection.
 */
async function handleModLogStep(
    interaction: ButtonInteraction,
    client: ExtendedClient,
    guild: Guild,
    message: Message,
    disabledModules: string[]
): Promise<void> {
    // Apply module toggles
    await db.update(guilds)
        .set({
            moderationEnabled: !disabledModules.includes('moderation'),
            musicEnabled: !disabledModules.includes('music'),
            levelingEnabled: !disabledModules.includes('leveling'),
            economyEnabled: !disabledModules.includes('economy'),
            updatedAt: new Date(),
        })
        .where(eq(guilds.id, guild.id));

    invalidateGuildCache(guild.id);

    // Get text channels the bot can see
    const textChannels = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.SendMessages))
        .map(ch => ({ label: `#${ch.name}`, value: ch.id }))
        .slice(0, 25); // Discord limit

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Quick Setup — Step 2/3')
        .setDescription(
            `**Where should moderation logs be sent?**\n\n` +
            `This channel will receive logs for warnings, bans, kicks, and other mod actions.\n\n` +
            `Select a channel below, or click Skip to set this up later.`
        )
        .setFooter({ text: 'You can change this anytime with /moderation config' });

    const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    if (textChannels.length > 0) {
        const channelMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`onboarding:modlog:${guild.id}`)
                .setPlaceholder('Select a channel...')
                .addOptions(textChannels)
        );
        components.push(channelMenu);
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`onboarding:modlog_skip:${guild.id}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
    );
    components.push(buttonRow);

    await interaction.update({ embeds: [embed], components });

    const collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
        if (i.isStringSelectMenu() && i.customId === `onboarding:modlog:${guild.id}`) {
            const channelId = i.values[0];
            await db.update(moderationSettings)
                .set({ modLogChannelId: channelId, updatedAt: new Date() })
                .where(eq(moderationSettings.guildId, guild.id));
            collector.stop('selected');
            await handleLevelUpStep(i as StringSelectMenuInteraction, client, guild, message);
        } else if (i.isButton() && i.customId === `onboarding:modlog_skip:${guild.id}`) {
            collector.stop('skip');
            await handleLevelUpStep(i as ButtonInteraction, client, guild, message);
        }
    });
}

/**
 * Step 3: Level-up announcement channel selection.
 */
async function handleLevelUpStep(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    client: ExtendedClient,
    guild: Guild,
    message: Message
): Promise<void> {
    const textChannels = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me!)?.has(PermissionFlagsBits.SendMessages))
        .map(ch => ({ label: `#${ch.name}`, value: ch.id }))
        .slice(0, 25);

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Quick Setup — Step 3/3')
        .setDescription(
            `**Where should level-up announcements be sent?**\n\n` +
            `When members level up, a congratulations message will be posted here.\n\n` +
            `Select a channel below, or click Skip to disable announcements for now.`
        )
        .setFooter({ text: 'You can change this anytime with /leveling config' });

    const components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

    if (textChannels.length > 0) {
        const channelMenu = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`onboarding:levelup:${guild.id}`)
                .setPlaceholder('Select a channel...')
                .addOptions(textChannels)
        );
        components.push(channelMenu);
    }

    const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`onboarding:levelup_skip:${guild.id}`)
            .setLabel('Skip')
            .setStyle(ButtonStyle.Secondary)
    );
    components.push(buttonRow);

    await interaction.update({ embeds: [embed], components });

    const collector = message.createMessageComponentCollector({
        time: 10 * 60 * 1000,
    });

    collector.on('collect', async (i) => {
        if (i.isStringSelectMenu() && i.customId === `onboarding:levelup:${guild.id}`) {
            const channelId = i.values[0];
            await db.update(levelingSettings)
                .set({ announceChannelId: channelId, updatedAt: new Date() })
                .where(eq(levelingSettings.guildId, guild.id));
            collector.stop('selected');
            await finishOnboarding(i as StringSelectMenuInteraction, guild);
        } else if (i.isButton() && i.customId === `onboarding:levelup_skip:${guild.id}`) {
            collector.stop('skip');
            await finishOnboarding(i as ButtonInteraction, guild);
        }
    });
}

/**
 * Completes the onboarding process and shows a summary.
 */
async function finishOnboarding(
    interaction: ButtonInteraction | StringSelectMenuInteraction,
    guild: Guild
): Promise<void> {
    await markOnboardingComplete(guild.id);

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🎉 Setup Complete!')
        .setDescription(
            `Awesome! **${guild.name}** is all set up.\n\n` +
            `Here are some commands to get you started:\n\n` +
            `🛡️ \`/warn\`, \`/kick\`, \`/ban\` — Moderation\n` +
            `🎵 \`/play\`, \`/queue\`, \`/skip\` — Music\n` +
            `📊 \`/rank\`, \`/leaderboard\` — Leveling\n` +
            `💰 \`/daily\`, \`/balance\`, \`/shop\` — Economy\n\n` +
            `Use \`/help\` to see all available commands. Enjoy!`
        )
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
}

/**
 * Marks onboarding as complete in the database.
 */
async function markOnboardingComplete(guildId: string): Promise<void> {
    await db.update(guilds)
        .set({ onboardingCompleted: true, updatedAt: new Date() })
        .where(eq(guilds.id, guildId));

    invalidateGuildCache(guildId);
    logger.info({ guildId }, 'Onboarding completed');
}
