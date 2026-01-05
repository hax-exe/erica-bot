import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { db } from '../db/index.js';
import { guildRankBackgrounds } from '../db/schema/index.js';
import { eq, and, asc } from 'drizzle-orm';
import { createLogger } from './logger.js';
import type { Attachment } from 'discord.js';

const logger = createLogger('cloudStorage');

const MAX_BACKGROUNDS_PER_GUILD = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// Initialize S3 client lazily to avoid issues when env vars are not set
function getS3Client() {
    const config: ConstructorParameters<typeof S3Client>[0] = {
        region: process.env.S3_REGION || 'auto',
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        },
        // Enable path-style for MinIO and other self-hosted S3-compatible storage
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    };

    if (process.env.S3_ENDPOINT) {
        config.endpoint = process.env.S3_ENDPOINT;
    }

    return new S3Client(config);
}

const BUCKET = process.env.S3_BUCKET || 'erica-bot-assets';
const PUBLIC_URL = process.env.S3_PUBLIC_URL || '';

export function isS3Configured(): boolean {
    return !!(
        process.env.S3_ENDPOINT &&
        process.env.S3_ACCESS_KEY_ID &&
        process.env.S3_SECRET_ACCESS_KEY &&
        process.env.S3_BUCKET
    );
}

export function getBackgroundUrl(id: string): string {
    if (PUBLIC_URL) {
        return `${PUBLIC_URL}/rank-backgrounds/${id}`;
    }
    return `s3://${BUCKET}/rank-backgrounds/${id}`;
}

// fetch directly from S3, bypassing public URL (more secure)
export async function fetchBackgroundImage(id: string): Promise<Buffer | null> {
    try {
        // Look up guildId from database
        const record = await db.query.guildRankBackgrounds.findFirst({
            where: eq(guildRankBackgrounds.id, id),
        });

        if (!record) {
            logger.warn({ id }, 'Background not found in database');
            return null;
        }

        const command = new GetObjectCommand({
            Bucket: BUCKET,
            Key: getS3Key(record.guildId, id),
        });

        const response = await getS3Client().send(command);

        if (!response.Body) {
            return null;
        }

        // Convert stream to buffer
        const chunks: Uint8Array[] = [];
        for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    } catch (error) {
        logger.warn({ id, error }, 'Failed to fetch background from S3');
        return null;
    }
}

function getS3Key(guildId: string, id: string): string {
    return `rank-backgrounds/${guildId}/${id}`;
}

// uploads to S3, auto-deletes oldest if guild has MAX_BACKGROUNDS_PER_GUILD
export async function uploadBackground(
    guildId: string,
    attachment: Attachment,
    uploaderId: string
): Promise<{ id: string; url: string; deletedOldId?: string }> {
    // Validate file
    if (attachment.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    const mimeType = attachment.contentType;
    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
        throw new Error(`Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    // Check current background count and delete oldest if needed
    let deletedOldId: string | undefined;
    const existingBackgrounds = await db.query.guildRankBackgrounds.findMany({
        where: eq(guildRankBackgrounds.guildId, guildId),
        orderBy: [asc(guildRankBackgrounds.createdAt)],
    });

    if (existingBackgrounds.length >= MAX_BACKGROUNDS_PER_GUILD) {
        const oldest = existingBackgrounds[0];
        if (oldest) {
            await deleteBackground(oldest.id);
            deletedOldId = oldest.id;
            logger.info({ guildId, deletedId: oldest.id }, 'Deleted oldest background to make room for new one');
        }
    }

    // Download the image from Discord
    const response = await fetch(attachment.url);
    if (!response.ok) {
        throw new Error('Failed to download image from Discord');
    }
    const imageBuffer = Buffer.from(await response.arrayBuffer());

    // Generate the database record first to get the UUID
    const [inserted] = await db.insert(guildRankBackgrounds).values({
        guildId,
        originalName: attachment.name,
        mimeType,
        fileSize: attachment.size,
        uploadedBy: uploaderId,
        isActive: false,
    }).returning();

    if (!inserted) {
        throw new Error('Failed to create database record');
    }

    const backgroundId = inserted.id;

    // Upload to S3 (organized by guild)
    try {
        const command = new PutObjectCommand({
            Bucket: BUCKET,
            Key: getS3Key(guildId, backgroundId),
            Body: imageBuffer,
            ContentType: mimeType,
        });

        await getS3Client().send(command);
        logger.info({ guildId, backgroundId }, 'Uploaded background to S3');
    } catch (error) {
        // Rollback database record if S3 upload fails
        await db.delete(guildRankBackgrounds).where(eq(guildRankBackgrounds.id, backgroundId));
        throw new Error(`Failed to upload to S3: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    const result: { id: string; url: string; deletedOldId?: string } = {
        id: backgroundId,
        url: getBackgroundUrl(backgroundId),
    };

    if (deletedOldId) {
        result.deletedOldId = deletedOldId;
    }

    return result;
}

export async function deleteBackground(id: string): Promise<void> {
    // Look up guildId from database first
    const record = await db.query.guildRankBackgrounds.findFirst({
        where: eq(guildRankBackgrounds.id, id),
    });

    // Delete from S3
    if (record) {
        try {
            const command = new DeleteObjectCommand({
                Bucket: BUCKET,
                Key: getS3Key(record.guildId, id),
            });
            await getS3Client().send(command);
        } catch (error) {
            logger.warn({ id, error }, 'Failed to delete from S3 (may not exist)');
        }
    }

    // Delete from database
    await db.delete(guildRankBackgrounds).where(eq(guildRankBackgrounds.id, id));
}

export async function listBackgrounds(guildId: string) {
    return db.query.guildRankBackgrounds.findMany({
        where: eq(guildRankBackgrounds.guildId, guildId),
        orderBy: [asc(guildRankBackgrounds.createdAt)],
    });
}

// sets one bg as active, deactivates the rest
export async function setActiveBackground(guildId: string, backgroundId: string): Promise<boolean> {
    // First verify the background exists and belongs to this guild
    const background = await db.query.guildRankBackgrounds.findFirst({
        where: and(
            eq(guildRankBackgrounds.id, backgroundId),
            eq(guildRankBackgrounds.guildId, guildId)
        ),
    });

    if (!background) {
        return false;
    }

    // Deactivate all backgrounds for this guild
    await db.update(guildRankBackgrounds)
        .set({ isActive: false })
        .where(eq(guildRankBackgrounds.guildId, guildId));

    // Activate the selected one
    await db.update(guildRankBackgrounds)
        .set({ isActive: true })
        .where(eq(guildRankBackgrounds.id, backgroundId));

    return true;
}

export async function getActiveBackgroundId(guildId: string): Promise<string | null> {
    const active = await db.query.guildRankBackgrounds.findFirst({
        where: and(
            eq(guildRankBackgrounds.guildId, guildId),
            eq(guildRankBackgrounds.isActive, true)
        ),
    });

    return active ? active.id : null;
}

export async function resetToDefault(guildId: string): Promise<void> {
    await db.update(guildRankBackgrounds)
        .set({ isActive: false })
        .where(eq(guildRankBackgrounds.guildId, guildId));
}
