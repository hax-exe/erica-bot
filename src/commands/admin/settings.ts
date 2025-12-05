import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { guilds } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('settings')
        .setDescription('View and manage bot settings')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('view')
                .setDescription('View current settings')
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('module')
                .setDescription('Enable or disable a module')
                .addStringOption((option) =>
                    option
                        .setName('module')
                        .setDescription('The module to toggle')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Moderation', value: 'moderation' },
                            { name: 'Music', value: 'music' },
                            { name: 'Leveling', value: 'leveling' },
                            { name: 'Economy', value: 'economy' },
                        )
                )
                .addBooleanOption((option) =>
                    option
                        .setName('enabled')
                        .setDescription('Enable or disable the module')
                        .setRequired(true)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('prefix')
                .setDescription('Set the bot prefix (for legacy commands)')
                .addStringOption((option) =>
                    option
                        .setName('prefix')
                        .setDescription('The new prefix')
                        .setRequired(true)
                        .setMaxLength(10)
                )
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'admin',
    cooldown: 5,
    guildOnly: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'view') {
            await handleView(interaction);
        } else if (subcommand === 'module') {
            await handleModule(interaction);
        } else if (subcommand === 'prefix') {
            await handlePrefix(interaction);
        }
    },
});

async function handleView(interaction: any): Promise<void> {
    const guildId = interaction.guildId!;

    const guildData = await db.query.guilds.findFirst({
        where: eq(guilds.id, guildId),
    });

    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('⚙️ Server Settings')
        .addFields(
            { name: 'Prefix', value: `\`${guildData?.prefix || '!'}\``, inline: true },
            { name: 'Language', value: guildData?.language || 'en', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🛡️ Moderation', value: guildData?.moderationEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '🎵 Music', value: guildData?.musicEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '📊 Leveling', value: guildData?.levelingEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
            { name: '💰 Economy', value: guildData?.economyEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
        )
        .setFooter({ text: 'Use /settings module to enable/disable modules' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleModule(interaction: any): Promise<void> {
    const module = interaction.options.getString('module', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    const guildId = interaction.guildId!;

    const columnMap: Record<string, string> = {
        moderation: 'moderationEnabled',
        music: 'musicEnabled',
        leveling: 'levelingEnabled',
        economy: 'economyEnabled',
    };

    const column = columnMap[module];
    if (!column) {
        await interaction.reply({
            content: '❌ Invalid module.',
            ephemeral: true,
        });
        return;
    }

    await db.update(guilds)
        .set({ [column]: enabled, updatedAt: new Date() })
        .where(eq(guilds.id, guildId));

    const embed = new EmbedBuilder()
        .setColor(enabled ? 0x00ff00 : 0xff0000)
        .setTitle(`⚙️ Module ${enabled ? 'Enabled' : 'Disabled'}`)
        .setDescription(`The **${module}** module has been ${enabled ? 'enabled' : 'disabled'}.`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handlePrefix(interaction: any): Promise<void> {
    const prefix = interaction.options.getString('prefix', true);
    const guildId = interaction.guildId!;

    await db.update(guilds)
        .set({ prefix, updatedAt: new Date() })
        .where(eq(guilds.id, guildId));

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('⚙️ Prefix Updated')
        .setDescription(`The bot prefix has been set to \`${prefix}\``)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
