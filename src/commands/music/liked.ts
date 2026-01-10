import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Command } from '../../types/Command.js';
import { db } from '../../db/index.js';
import { likedSongs } from '../../db/schema/index.js';
import { eq, desc } from 'drizzle-orm';

function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);

    if (h > 0) {
        return `${h}:${(m % 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
    }
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export default new Command({
    data: new SlashCommandBuilder()
        .setName('liked')
        .setDescription('Manage your liked songs')
        .addSubcommand((sub) =>
            sub.setName('play').setDescription('Play all your liked songs')
        )
        .addSubcommand((sub) =>
            sub.setName('list').setDescription('View your liked songs')
        )
        .addSubcommand((sub) =>
            sub.setName('clear').setDescription('Clear all your liked songs')
        ),
    category: 'music',
    cooldown: 3,
    guildOnly: true,
    requiredModule: 'music',

    async execute(interaction, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'play': {
                await interaction.deferReply();

                const member = interaction.member as any;
                const vc = member?.voice?.channel;

                if (!vc) {
                    await interaction.editReply('❌ You must be in a voice channel to use this command.');
                    return;
                }

                // Fetch user's liked songs
                const songs = await db.select()
                    .from(likedSongs)
                    .where(eq(likedSongs.userId, interaction.user.id))
                    .orderBy(desc(likedSongs.likedAt));

                if (songs.length === 0) {
                    await interaction.editReply('❌ You have no liked songs! Use the 💜 button on the music player to like songs.');
                    return;
                }

                try {
                    let player = client.music.players.get(interaction.guildId!);

                    if (!player) {
                        player = await client.music.createPlayer({
                            guildId: interaction.guildId!,
                            textId: interaction.channelId,
                            voiceId: vc.id,
                            volume: 50,
                            deaf: true,
                        });
                    }

                    let addedCount = 0;

                    for (const song of songs) {
                        try {
                            const result = await client.music.search(song.trackUri, {
                                requester: interaction.user,
                            });

                            if (result.tracks.length > 0) {
                                player.queue.add(result.tracks[0]!);
                                addedCount++;
                            }
                        } catch {
                            // Skip tracks that fail to resolve
                        }
                    }

                    if (addedCount === 0) {
                        await interaction.editReply('❌ Could not find any of your liked songs.');
                        return;
                    }

                    const embed = new EmbedBuilder()
                        .setColor(0x7c3aed)
                        .setTitle('💜 Playing Liked Songs')
                        .setDescription(`Added **${addedCount}** of your liked songs to the queue!`)
                        .setFooter({ text: `Requested by ${interaction.user.tag}` });

                    await interaction.editReply({ embeds: [embed] });

                    if (!player.playing && !player.paused) {
                        await player.play();
                    }
                } catch (error) {
                    console.error('Liked songs play error:', error);
                    await interaction.editReply('❌ An error occurred while playing your liked songs.');
                }
                break;
            }

            case 'list': {
                await interaction.deferReply({ ephemeral: true });

                const songs = await db.select()
                    .from(likedSongs)
                    .where(eq(likedSongs.userId, interaction.user.id))
                    .orderBy(desc(likedSongs.likedAt))
                    .limit(20);

                if (songs.length === 0) {
                    await interaction.editReply('❌ You have no liked songs! Use the 💜 button on the music player to like songs.');
                    return;
                }

                // Get total count
                const allSongs = await db.select()
                    .from(likedSongs)
                    .where(eq(likedSongs.userId, interaction.user.id));

                const totalCount = allSongs.length;

                const songList = songs
                    .map((song, i) => {
                        const duration = song.duration ? formatDuration(song.duration) : '??:??';
                        return `**${i + 1}.** ${song.trackTitle} - ${song.trackAuthor || 'Unknown'} (${duration})`;
                    })
                    .join('\n');

                const embed = new EmbedBuilder()
                    .setColor(0x7c3aed)
                    .setTitle('💜 Your Liked Songs')
                    .setDescription(songList)
                    .setFooter({ text: `Showing ${songs.length} of ${totalCount} liked songs` });

                await interaction.editReply({ embeds: [embed] });
                break;
            }

            case 'clear': {
                await interaction.deferReply({ ephemeral: true });

                // Get count first
                const songs = await db.select()
                    .from(likedSongs)
                    .where(eq(likedSongs.userId, interaction.user.id));

                if (songs.length === 0) {
                    await interaction.editReply('❌ You have no liked songs to clear.');
                    return;
                }

                // Delete all liked songs for this user
                await db.delete(likedSongs)
                    .where(eq(likedSongs.userId, interaction.user.id));

                await interaction.editReply(`🗑️ Cleared **${songs.length}** liked songs from your library.`);
                break;
            }
        }
    },
});
