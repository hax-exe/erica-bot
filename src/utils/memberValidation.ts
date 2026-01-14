import { Guild, GuildMember, ChatInputCommandInteraction } from 'discord.js';

/**
 * Validates a user is a member of the guild.
 * Checks the cache first, then attempts a fetch if not cached.
 * @returns The GuildMember if found, null otherwise
 */
export async function validateMember(
    guild: Guild,
    userId: string
): Promise<GuildMember | null> {
    // Check cache first
    let member = guild.members.cache.get(userId);
    if (member) return member;

    // Try fetching from API
    try {
        member = await guild.members.fetch(userId);
        return member;
    } catch {
        return null;
    }
}

/**
 * Validates a user is a member of the guild and sends an error reply if not.
 * Useful for commands that require the target user to be in the server.
 * @returns The GuildMember if found, null if not (error reply already sent)
 */
export async function validateMemberWithError(
    interaction: ChatInputCommandInteraction,
    userId: string,
    userName: string
): Promise<GuildMember | null> {
    const member = await validateMember(interaction.guild!, userId);

    if (!member) {
        await interaction.reply({
            content: `❌ **${userName}** is not a member of this server.`,
            ephemeral: true,
        });
        return null;
    }

    return member;
}
