import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function deployCommands() {
    const commands: any[] = [];
    const commandsPath = join(__dirname, 'commands');
    const commandFolders = readdirSync(commandsPath);

    console.log('📦 Loading commands...');

    for (const folder of commandFolders) {
        const folderPath = join(commandsPath, folder);
        const commandFiles = readdirSync(folderPath).filter(file => file.endsWith('.ts') || file.endsWith('.js'));

        for (const file of commandFiles) {
            const filePath = join(folderPath, file);
            const command = (await import(filePath)).default;

            if (command?.data) {
                commands.push(command.data.toJSON());
                console.log(`  ✓ Loaded: ${command.data.name}`);
            }
        }
    }

    console.log(`\n📤 Deploying ${commands.length} commands...`);

    const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

    try {
        // Deploy to dev guild (faster) or globally
        if (process.env.DISCORD_DEV_GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(
                    process.env.DISCORD_CLIENT_ID!,
                    process.env.DISCORD_DEV_GUILD_ID
                ),
                { body: commands }
            );
            console.log(`✅ Successfully deployed ${commands.length} commands to dev guild!`);
        } else {
            await rest.put(
                Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!),
                { body: commands }
            );
            console.log(`✅ Successfully deployed ${commands.length} commands globally!`);
            console.log('⚠️  Note: Global commands may take up to 1 hour to appear.');
        }
    } catch (error) {
        console.error('❌ Failed to deploy commands:', error);
        process.exit(1);
    }
}

deployCommands();
