import { ActivityType, type Client } from 'discord.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('status-rotator');

interface StatusEntry {
    text: string;
    type: ActivityType;
}

// List of statuses to rotate through
const statuses: StatusEntry[] = [
    { text: '/help | Erica Bot', type: ActivityType.Watching },
    { text: 'Over {users} users', type: ActivityType.Watching },
    { text: 'Music for {guilds} servers', type: ActivityType.Playing },
    { text: 'your favorite tunes', type: ActivityType.Listening },
];

// Rotation interval (10 seconds)
const ROTATION_INTERVAL_MS = 10 * 1000;

let rotationInterval: ReturnType<typeof setInterval> | null = null;
let currentIndex = 0;

/**
 * Replaces placeholders in status text with actual values
 */
function formatStatus(client: Client, text: string): string {
    const guildCount = client.guilds.cache.size;
    const userCount = client.guilds.cache.reduce(
        (acc, guild) => acc + (guild.memberCount || 0),
        0
    );

    return text
        .replace('{guilds}', guildCount.toLocaleString())
        .replace('{users}', userCount.toLocaleString());
}

/**
 * Updates the bot's presence to the current status
 */
function updatePresence(client: Client): void {
    const status = statuses[currentIndex]!;
    const formattedText = formatStatus(client, status.text);

    client.user?.setPresence({
        status: 'online',
        activities: [
            {
                name: formattedText,
                type: status.type,
            },
        ],
    });

    logger.debug(`Status rotated to: "${formattedText}"`);
}

/**
 * Starts the status rotation system
 */
export function startStatusRotation(client: Client): void {
    // Set initial status
    updatePresence(client);

    // Clear any existing interval
    if (rotationInterval) {
        clearInterval(rotationInterval);
    }

    // Start rotation
    rotationInterval = setInterval(() => {
        currentIndex = (currentIndex + 1) % statuses.length;
        updatePresence(client);
    }, ROTATION_INTERVAL_MS);

    logger.info(`Status rotation started (${statuses.length} statuses, ${ROTATION_INTERVAL_MS / 1000}s interval)`);
}

/**
 * Stops the status rotation
 */
export function stopStatusRotation(): void {
    if (rotationInterval) {
        clearInterval(rotationInterval);
        rotationInterval = null;
        logger.info('Status rotation stopped');
    }
}
