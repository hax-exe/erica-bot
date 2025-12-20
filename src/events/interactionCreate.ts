import { Events, Collection } from 'discord.js';
import { Event } from '../types/Event.js';
import { createLogger } from '../utils/logger.js';
import { getGuildSettings } from '../services/settingsCache.js';

const logger = createLogger('interaction');

export default new Event({
    name: Events.InteractionCreate,
    async execute(client, interaction) {
        // Handle slash commands
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);

            if (!command) {
                logger.warn(`Unknown command: ${interaction.commandName}`);
                return;
            }

            // Check if guild-only command is used in DMs
            if (command.guildOnly && !interaction.guild) {
                await interaction.reply({
                    content: '❌ This command can only be used in a server.',
                    ephemeral: true,
                });
                return;
            }

            // Check required module (using cached settings)
            if (command.requiredModule && interaction.guild) {
                const guildData = await getGuildSettings(interaction.guild.id);

                const moduleEnabled = guildData?.[`${command.requiredModule}Enabled` as keyof typeof guildData];
                if (guildData && !moduleEnabled) {
                    await interaction.reply({
                        content: `❌ The ${command.requiredModule} module is disabled on this server.`,
                        ephemeral: true,
                    });
                    return;
                }
            }

            // Handle cooldowns
            if (command.cooldown) {
                if (!client.cooldowns.has(command.data.name)) {
                    client.cooldowns.set(command.data.name, new Collection());
                }

                const now = Date.now();
                const timestamps = client.cooldowns.get(command.data.name)!;
                const cooldownAmount = command.cooldown * 1000;

                if (timestamps.has(interaction.user.id)) {
                    const expirationTime = timestamps.get(interaction.user.id)! + cooldownAmount;

                    if (now < expirationTime) {
                        const timeLeft = ((expirationTime - now) / 1000).toFixed(1);
                        await interaction.reply({
                            content: `⏳ Please wait ${timeLeft}s before using \`/${command.data.name}\` again.`,
                            ephemeral: true,
                        });
                        return;
                    }
                }

                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }

            // Execute command
            try {
                logger.debug({
                    command: interaction.commandName,
                    user: interaction.user.tag,
                    guild: interaction.guild?.name,
                }, 'Executing command');

                await command.execute(interaction, client);
            } catch (error: any) {
                // Check if this is an expired interaction error (10062)
                const isExpiredInteraction = error?.code === 10062;

                if (isExpiredInteraction) {
                    logger.warn({ command: interaction.commandName }, 'Interaction expired before response');
                    return;
                }

                logger.error({ error, command: interaction.commandName }, 'Command execution failed');

                const errorMessage = '❌ An error occurred while executing this command.';

                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, ephemeral: true });
                    } else {
                        await interaction.reply({ content: errorMessage, ephemeral: true });
                    }
                } catch {
                    // Interaction may have expired, ignore
                }
            }
        }

        // Handle autocomplete
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);

            if (!command?.autocomplete) return;

            try {
                await command.autocomplete(interaction, client);
            } catch (error) {
                logger.error({ error, command: interaction.commandName }, 'Autocomplete failed');
            }
        }

        // Handle button interactions (for giveaways, music controls, etc.)
        if (interaction.isButton()) {
            // TODO: Add button handlers
            logger.debug({ customId: interaction.customId }, 'Button interaction');
        }

        // Handle select menu interactions
        if (interaction.isAnySelectMenu()) {
            // TODO: Add select menu handlers
            logger.debug({ customId: interaction.customId }, 'Select menu interaction');
        }
    },
});
