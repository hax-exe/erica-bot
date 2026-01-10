import {
    SlashCommandBuilder,
    PermissionFlagsBits,
} from 'discord.js';
import { Command } from '../../types/Command.js';
import { sendOnboardingMessage } from '../../services/onboarding.js';
import { db } from '../../db/index.js';
import { guilds } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('onboarding')
        .setDescription('Trigger the onboarding setup wizard')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    category: 'admin',
    cooldown: 60,
    guildOnly: true,

    async execute(interaction) {
        const guild = interaction.guild!;

        // Reset onboarding status so it can be triggered again
        await db.update(guilds)
            .set({ onboardingCompleted: false, updatedAt: new Date() })
            .where(eq(guilds.id, guild.id));

        await interaction.reply({
            content: '📬 Sending onboarding DM to the server owner...',
            ephemeral: true,
        });

        try {
            await sendOnboardingMessage(interaction.client as any, guild);
            await interaction.editReply({
                content: '✅ Onboarding DM sent! Check the server owner\'s DMs.',
            });
        } catch (error) {
            await interaction.editReply({
                content: '❌ Failed to send onboarding DM. The server owner may have DMs disabled.',
            });
        }
    },
});
