import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

export async function GET(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession();

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const guildId = params.id;

    // In production, fetch from your database
    // For now, return mock data
    const settings = {
        id: guildId,
        prefix: "!",
        language: "en",
        moderationEnabled: true,
        musicEnabled: true,
        levelingEnabled: true,
        economyEnabled: true,
        autoModEnabled: false,
        autoModSettings: {
            bannedWords: [],
            antiSpamEnabled: false,
            maxMentions: 5,
        },
        levelingSettings: {
            xpPerMessage: 15,
            xpCooldown: 60,
            announceEnabled: true,
            announceChannelId: null,
        },
        economySettings: {
            currencyName: "coins",
            currencySymbol: "🪙",
            dailyAmount: 100,
        },
    };

    return NextResponse.json(settings);
}

export async function PATCH(
    request: Request,
    { params }: { params: { id: string } }
) {
    const session = await getServerSession();

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const guildId = params.id;
    const body = await request.json();

    // In production, update your database here
    // Validate that the user has permission to modify this guild's settings

    return NextResponse.json({ success: true, guildId, updated: body });
}
