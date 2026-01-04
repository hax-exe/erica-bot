import {
    SlashCommandBuilder,
    EmbedBuilder,
    PermissionFlagsBits,
    ChatInputCommandInteraction,
    AttachmentBuilder,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import {
    uploadBackground,
    deleteBackground,
    listBackgrounds,
    setActiveBackground,
    resetToDefault,
    isS3Configured,
    fetchBackgroundImage,
} from '../../utils/cloudStorage.js';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('rankcard')
        .setDescription('Manage rank card backgrounds for this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(subcommand =>
            subcommand
                .setName('upload')
                .setDescription('Upload a custom rank card background')
                .addAttachmentOption(option =>
                    option
                        .setName('image')
                        .setDescription('The background image (PNG, JPG, or WebP, max 5MB)')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all uploaded backgrounds')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set the active background')
                .addStringOption(option =>
                    option
                        .setName('id')
                        .setDescription('The UUID of the background to activate')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete an uploaded background')
                .addStringOption(option =>
                    option
                        .setName('id')
                        .setDescription('The UUID of the background to delete')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('reset')
                .setDescription('Reset to use default backgrounds')
        ),
    category: 'leveling',
    cooldown: 5,
    guildOnly: true,
    requiredModule: 'leveling',

    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'upload':
                await handleUpload(interaction);
                break;
            case 'list':
                await handleList(interaction);
                break;
            case 'set':
                await handleSet(interaction);
                break;
            case 'delete':
                await handleDelete(interaction);
                break;
            case 'reset':
                await handleReset(interaction);
                break;
        }
    },
});

async function handleUpload(interaction: ChatInputCommandInteraction) {
    if (!isS3Configured()) {
        await interaction.reply({
            content: '❌ Cloud storage is not configured. Please contact the bot administrator.',
            ephemeral: true,
        });
        return;
    }

    const attachment = interaction.options.getAttachment('image', true);

    await interaction.deferReply({ ephemeral: true });

    try {
        const result = await uploadBackground(
            interaction.guildId!,
            attachment,
            interaction.user.id
        );

        let message = `✅ Background uploaded successfully!\n\n**ID:** \`${result.id}\``;

        if (result.deletedOldId) {
            message += `\n\n⚠️ Oldest background (\`${result.deletedOldId}\`) was automatically deleted to stay within the 3-image limit.`;
        }

        message += `\n\nUse \`/rankcard set ${result.id}\` to activate this background.`;

        await interaction.editReply({ content: message });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await interaction.editReply({ content: `❌ Failed to upload: ${errorMessage}` });
    }
}

async function handleList(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const backgrounds = await listBackgrounds(interaction.guildId!);

    if (backgrounds.length === 0) {
        await interaction.editReply({
            content: '📭 No custom backgrounds uploaded. Use `/rankcard upload` to add one!',
        });
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('🖼️ Rank Card Backgrounds')
        .setDescription(`${backgrounds.length}/3 backgrounds uploaded\n\nUse \`/rankcard set <id>\` to activate a background.`)
        .setColor(0x5865f2);

    // Fetch images and create attachments
    const attachments: AttachmentBuilder[] = [];

    for (let i = 0; i < backgrounds.length; i++) {
        const bg = backgrounds[i];
        if (!bg) continue;

        const status = bg.isActive ? '✅ **Active**' : '';
        const uploadDate = bg.createdAt ? new Date(bg.createdAt).toLocaleDateString() : 'Unknown';

        // Try to fetch the image
        const imageBuffer = await fetchBackgroundImage(bg.id);
        const fileName = `bg_${i + 1}.png`;

        if (imageBuffer) {
            attachments.push(new AttachmentBuilder(imageBuffer, { name: fileName }));
            embed.addFields({
                name: `${i + 1}. ${bg.originalName || 'Unnamed'} ${status}`,
                value: `**ID:** \`${bg.id}\`\n**Uploaded:** ${uploadDate}`,
                inline: false,
            });
        } else {
            embed.addFields({
                name: `${i + 1}. ${bg.originalName || 'Unnamed'} ${status}`,
                value: `**ID:** \`${bg.id}\`\n**Uploaded:** ${uploadDate}\n*(Image not available)*`,
                inline: false,
            });
        }
    }

    await interaction.editReply({ embeds: [embed], files: attachments });
}

async function handleSet(interaction: ChatInputCommandInteraction) {
    const backgroundId = interaction.options.getString('id', true);

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(backgroundId)) {
        await interaction.reply({
            content: '❌ Invalid background ID format.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    const success = await setActiveBackground(interaction.guildId!, backgroundId);

    if (success) {
        await interaction.editReply({
            content: `✅ Background \`${backgroundId}\` is now active!`,
        });
    } else {
        await interaction.editReply({
            content: '❌ Background not found. Use `/rankcard list` to see available backgrounds.',
        });
    }
}

async function handleDelete(interaction: ChatInputCommandInteraction) {
    const backgroundId = interaction.options.getString('id', true);

    // Validate UUID format to prevent injection
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(backgroundId)) {
        await interaction.reply({
            content: '❌ Invalid background ID format.',
            ephemeral: true,
        });
        return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Verify the background belongs to this guild before deleting
    const backgrounds = await listBackgrounds(interaction.guildId!);
    const belongsToGuild = backgrounds.some(bg => bg.id === backgroundId);

    if (!belongsToGuild) {
        await interaction.editReply({
            content: '❌ Background not found. Use `/rankcard list` to see available backgrounds.',
        });
        return;
    }

    try {
        await deleteBackground(backgroundId);
        await interaction.editReply({
            content: `✅ Background \`${backgroundId}\` has been deleted.`,
        });
    } catch {
        await interaction.editReply({
            content: '❌ Failed to delete background.',
        });
    }
}

async function handleReset(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    await resetToDefault(interaction.guildId!);

    await interaction.editReply({
        content: '✅ Reset to default backgrounds. Rank cards will now use the built-in backgrounds.',
    });
}
