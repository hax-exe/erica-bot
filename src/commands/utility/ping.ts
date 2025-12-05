import { SlashCommandBuilder, EmbedBuilder, version as djsVersion } from 'discord.js';
import { Command } from '../../types/Command.js';
import os from 'os';

export default new Command({
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check the bot\'s latency and status'),
    category: 'utility',
    cooldown: 3,

    async execute(interaction, client) {
        const sent = await interaction.deferReply({ fetchReply: true });
        const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
        const wsLatency = client.ws.ping;

        const uptimeSeconds = process.uptime();
        const days = Math.floor(uptimeSeconds / 86400);
        const hours = Math.floor((uptimeSeconds % 86400) / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);

        const uptime = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const memUsage = process.memoryUsage();
        const memUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

        const embed = new EmbedBuilder()
            .setColor(wsLatency < 100 ? 0x00ff00 : wsLatency < 300 ? 0xffff00 : 0xff0000)
            .setTitle('🏓 Pong!')
            .addFields(
                { name: '📡 Roundtrip', value: `\`${roundtrip}ms\``, inline: true },
                { name: '💓 WebSocket', value: `\`${wsLatency}ms\``, inline: true },
                { name: '⏱️ Uptime', value: `\`${uptime}\``, inline: true },
                { name: '🖥️ Memory', value: `\`${memUsedMB} MB\``, inline: true },
                { name: '📚 Discord.js', value: `\`v${djsVersion}\``, inline: true },
                { name: '📊 Guilds', value: `\`${client.guilds.cache.size}\``, inline: true },
            )
            .setFooter({ text: `Node.js ${process.version} • ${os.platform()}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
});
