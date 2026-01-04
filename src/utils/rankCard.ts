import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readdir } from 'fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = join(__dirname, '..', 'assets');

// Canvas dimensions
const CANVAS_WIDTH = 934;
const CANVAS_HEIGHT = 282;

// Colors
const COLORS = {
    background: '#1a1a2e',
    overlay: 'rgba(0, 0, 0, 0.5)',
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.7)',
    accent: '#5865f2',
    progressBg: 'rgba(255, 255, 255, 0.2)',
    progressFill: '#ffffff',
};

export interface RankCardData {
    username: string;
    avatarUrl: string;
    rank: number;
    level: number;
    currentXp: number;
    requiredXp: number;
    totalXp: number;
    backgroundBuffer?: Buffer;  // Direct image buffer from S3
}

/**
 * Format large numbers with k/M suffix
 */
function formatNumber(num: number): string {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(2) + 'k';
    }
    return num.toString();
}

/**
 * Draw a rounded rectangle
 */
function roundRect(
    ctx: SKRSContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * Get a random default background image
 */
async function getDefaultBackground(): Promise<string | null> {
    try {
        const backgroundsDir = join(ASSETS_DIR, 'backgrounds');
        const files = await readdir(backgroundsDir);
        const imageFiles = files.filter(f =>
            f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
        );

        if (imageFiles.length === 0) return null;

        const randomIndex = Math.floor(Math.random() * imageFiles.length);
        const randomFile = imageFiles[randomIndex];
        if (!randomFile) return null;

        return join(backgroundsDir, randomFile);
    } catch {
        return null;
    }
}

/**
 * Generate a rank card image
 */
export async function generateRankCard(data: RankCardData): Promise<Buffer> {
    const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
    const ctx = canvas.getContext('2d');

    // Draw background
    try {
        let bgImage = null;

        // Try to use provided background buffer from S3
        if (data.backgroundBuffer) {
            bgImage = await loadImage(data.backgroundBuffer);
        }

        // If no custom background, try to get a default one from local files
        if (!bgImage) {
            const defaultBgPath = await getDefaultBackground();
            if (defaultBgPath) {
                bgImage = await loadImage(defaultBgPath);
            }
        }

        if (bgImage) {
            // Draw background covering the entire canvas
            const scale = Math.max(CANVAS_WIDTH / bgImage.width, CANVAS_HEIGHT / bgImage.height);
            const scaledWidth = bgImage.width * scale;
            const scaledHeight = bgImage.height * scale;
            const offsetX = (CANVAS_WIDTH - scaledWidth) / 2;
            const offsetY = (CANVAS_HEIGHT - scaledHeight) / 2;
            ctx.drawImage(bgImage, offsetX, offsetY, scaledWidth, scaledHeight);
        } else {
            // Fallback gradient background
            const gradient = ctx.createLinearGradient(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
            gradient.addColorStop(0, '#1a1a2e');
            gradient.addColorStop(0.5, '#16213e');
            gradient.addColorStop(1, '#0f3460');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }
    } catch {
        // Fallback solid color
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }

    // Draw semi-transparent overlay for better text readability
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Avatar settings
    const avatarSize = 180;
    const avatarX = 50;
    const avatarY = (CANVAS_HEIGHT - avatarSize) / 2;
    const avatarCenterX = avatarX + avatarSize / 2;
    const avatarCenterY = avatarY + avatarSize / 2;

    // Draw avatar border/glow
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2 + 5, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.progressFill;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();

    // Draw circular avatar
    try {
        const avatar = await loadImage(data.avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
        ctx.restore();
    } catch {
        // Fallback: draw a colored circle
        ctx.save();
        ctx.beginPath();
        ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = COLORS.accent;
        ctx.fill();
        ctx.restore();
    }

    // Text positioning
    const textStartX = avatarX + avatarSize + 40;
    const rightPadding = 50;
    const textEndX = CANVAS_WIDTH - rightPadding;

    // Draw username
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = COLORS.primary;
    ctx.textAlign = 'left';

    // Truncate username if too long
    let displayUsername = data.username;
    const maxUsernameWidth = 250;
    while (ctx.measureText(displayUsername).width > maxUsernameWidth && displayUsername.length > 3) {
        displayUsername = displayUsername.slice(0, -1);
    }
    if (displayUsername !== data.username) {
        displayUsername += '...';
    }
    ctx.fillText(displayUsername, textStartX, 80);

    // Draw rank and level on the right
    ctx.textAlign = 'right';

    // Rank
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = COLORS.secondary;
    ctx.fillText('RANK', textEndX - 100, 60);
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(`#${data.rank}`, textEndX - 100, 110);

    // Level
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = COLORS.secondary;
    ctx.fillText('LEVEL', textEndX, 60);
    ctx.font = 'bold 48px sans-serif';
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(`${data.level}`, textEndX, 110);

    // XP text
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = COLORS.secondary;
    ctx.textAlign = 'right';
    ctx.fillText(
        `${formatNumber(data.currentXp)} / ${formatNumber(data.requiredXp)} XP`,
        textEndX,
        165
    );

    // Progress bar
    const progressBarX = textStartX;
    const progressBarY = 200;
    const progressBarWidth = textEndX - textStartX;
    const progressBarHeight = 35;
    const progressBarRadius = progressBarHeight / 2;
    const progress = Math.min(data.currentXp / data.requiredXp, 1);

    // Background of progress bar
    ctx.fillStyle = COLORS.progressBg;
    roundRect(ctx, progressBarX, progressBarY, progressBarWidth, progressBarHeight, progressBarRadius);
    ctx.fill();

    // Filled portion of progress bar
    if (progress > 0) {
        const filledWidth = Math.max(progressBarHeight, progressBarWidth * progress);
        ctx.fillStyle = COLORS.progressFill;
        roundRect(ctx, progressBarX, progressBarY, filledWidth, progressBarHeight, progressBarRadius);
        ctx.fill();
    }

    return canvas.toBuffer('image/png');
}
