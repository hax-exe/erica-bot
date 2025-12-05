import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { autoResponders } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('autoresponder')
        .setDescription('Manage auto-responders')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('add')
                .setDescription('Add a new auto-responder')
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Name for this auto-responder')
                        .setRequired(true)
                        .setMaxLength(64)
                )
                .addStringOption((option) =>
                    option
                        .setName('trigger')
                        .setDescription('The trigger text/word')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('response')
                        .setDescription('The response message')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('type')
                        .setDescription('How to match the trigger')
                        .addChoices(
                            { name: 'Contains', value: 'contains' },
                            { name: 'Exact Match', value: 'exact' },
                            { name: 'Starts With', value: 'startswith' },
                            { name: 'Regex', value: 'regex' },
                        )
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('remove')
                .setDescription('Remove an auto-responder')
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Name of the auto-responder to remove')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('list')
                .setDescription('List all auto-responders')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('toggle')
                .setDescription('Enable/disable an auto-responder')
                .addStringOption((option) =>
                    option
                        .setName('name')
                        .setDescription('Name of the auto-responder')
                        .setRequired(true)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'admin',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'add':
                await handleAdd(interaction);
                break;
            case 'remove':
                await handleRemove(interaction);
                break;
            case 'list':
                await handleList(interaction);
                break;
            case 'toggle':
                await handleToggle(interaction);
                break;
        }
    },
});

async function handleAdd(interaction: any): Promise<void> {
    const name = interaction.options.getString('name', true);
    const trigger = interaction.options.getString('trigger', true);
    const response = interaction.options.getString('response', true);
    const triggerType = interaction.options.getString('type') || 'contains';

    // Check if name already exists
    const existing = await db.query.autoResponders.findFirst({
        where: and(
            eq(autoResponders.guildId, interaction.guildId!),
            eq(autoResponders.name, name)
        ),
    });

    if (existing) {
        await interaction.reply({
            content: '❌ An auto-responder with this name already exists.',
            ephemeral: true,
        });
        return;
    }

    await db.insert(autoResponders).values({
        guildId: interaction.guildId!,
        name,
        trigger,
        triggerType,
        response,
        enabled: true,
    });

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('✅ Auto-Responder Added')
        .addFields(
            { name: 'Name', value: name, inline: true },
            { name: 'Trigger', value: trigger, inline: true },
            { name: 'Type', value: triggerType, inline: true },
            { name: 'Response', value: response.substring(0, 200) },
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleRemove(interaction: any): Promise<void> {
    const name = interaction.options.getString('name', true);

    const deleted = await db.delete(autoResponders)
        .where(and(
            eq(autoResponders.guildId, interaction.guildId!),
            eq(autoResponders.name, name)
        ))
        .returning();

    if (deleted.length === 0) {
        await interaction.reply({
            content: '❌ Auto-responder not found.',
            ephemeral: true,
        });
        return;
    }

    await interaction.reply({
        content: `✅ Removed auto-responder: **${name}**`,
    });
}

async function handleList(interaction: any): Promise<void> {
    const responders = await db.query.autoResponders.findMany({
        where: eq(autoResponders.guildId, interaction.guildId!),
    });

    if (responders.length === 0) {
        await interaction.reply({
            content: '📭 No auto-responders configured.',
            ephemeral: true,
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🤖 Auto-Responders')
        .setDescription(
            responders.map((r) =>
                `${r.enabled ? '✅' : '❌'} **${r.name}**\nTrigger: \`${r.trigger}\` (${r.triggerType})`
            ).join('\n\n')
        )
        .setFooter({ text: `${responders.length} auto-responder(s)` })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleToggle(interaction: any): Promise<void> {
    const name = interaction.options.getString('name', true);

    const responder = await db.query.autoResponders.findFirst({
        where: and(
            eq(autoResponders.guildId, interaction.guildId!),
            eq(autoResponders.name, name)
        ),
    });

    if (!responder) {
        await interaction.reply({
            content: '❌ Auto-responder not found.',
            ephemeral: true,
        });
        return;
    }

    await db.update(autoResponders)
        .set({ enabled: !responder.enabled })
        .where(eq(autoResponders.id, responder.id));

    await interaction.reply({
        content: `✅ Auto-responder **${name}** is now ${!responder.enabled ? 'enabled' : 'disabled'}.`,
    });
}
