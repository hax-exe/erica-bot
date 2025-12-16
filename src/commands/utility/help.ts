import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { Command, CommandCategory } from '../../types/Command.js';

const categoryEmojis: Record<CommandCategory, string> = {
    moderation: '🛡️',
    music: '🎵',
    leveling: '📊',
    economy: '💰',
    fun: '🎮',
    utility: '🔧',
    admin: '⚙️',
    giveaway: '🎉',
    social: '📱',
};

const categoryDescriptions: Record<CommandCategory, string> = {
    moderation: 'Server moderation and auto-mod tools',
    music: 'Music playback and queue management',
    leveling: 'XP, levels, and rank cards',
    economy: 'Virtual currency and shop',
    fun: 'Games and entertainment',
    utility: 'Useful utility commands',
    admin: 'Server configuration',
    giveaway: 'Giveaway management',
    social: 'Social feed notifications',
};

export default new Command({
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get information about bot commands')
        .addStringOption((option) =>
            option
                .setName('command')
                .setDescription('Get detailed info about a specific command')
                .setAutocomplete(true)
        ),
    category: 'utility',
    cooldown: 3,

    async execute(interaction, client) {
        const commandName = interaction.options.getString('command');

        if (commandName) {
            // Show specific command info
            const command = client.commands.get(commandName);

            if (!command) {
                await interaction.reply({
                    content: `❌ Command \`${commandName}\` not found.`,
                    ephemeral: true,
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865f2)
                .setTitle(`${categoryEmojis[command.category]} /${command.data.name}`)
                .setDescription(command.data.description)
                .addFields(
                    { name: 'Category', value: command.category, inline: true },
                    { name: 'Cooldown', value: `${command.cooldown || 0}s`, inline: true },
                    { name: 'Guild Only', value: command.guildOnly ? 'Yes' : 'No', inline: true },
                );

            if (command.requiredModule) {
                embed.addFields({ name: 'Required Module', value: command.requiredModule, inline: true });
            }

            await interaction.reply({ embeds: [embed] });
            return;
        }

        // Show all commands grouped by category
        const categories = new Map<CommandCategory, string[]>();

        for (const [name, command] of client.commands) {
            if (!categories.has(command.category)) {
                categories.set(command.category, []);
            }
            categories.get(command.category)!.push(name);
        }

        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle('📚 Erica Bot Help')
            .setDescription('Select a category from the dropdown or use `/help <command>` for details.')
            .setFooter({ text: `${client.commands.size} total commands` })
            .setTimestamp();

        for (const [category, commands] of categories) {
            embed.addFields({
                name: `${categoryEmojis[category]} ${category.charAt(0).toUpperCase() + category.slice(1)}`,
                value: commands.map((c) => `\`${c}\``).join(', ') || 'No commands',
                inline: false,
            });
        }

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('help_category')
            .setPlaceholder('Select a category for details')
            .addOptions(
                Array.from(categories.keys()).map((category) => ({
                    label: category.charAt(0).toUpperCase() + category.slice(1),
                    description: categoryDescriptions[category],
                    value: category,
                    emoji: categoryEmojis[category],
                }))
            );

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = Array.from(client.commands.keys())
            .filter((name) => name.toLowerCase().includes(focused))
            .slice(0, 25);

        await interaction.respond(
            choices.map((name) => ({ name, value: name }))
        );
    },
});
