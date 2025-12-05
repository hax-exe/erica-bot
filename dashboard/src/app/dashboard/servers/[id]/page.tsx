"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
    ArrowLeft,
    Shield,
    Music,
    TrendingUp,
    Coins,
    Settings,
    Save,
    ToggleLeft,
    ToggleRight,
} from "lucide-react";

interface GuildSettings {
    id: string;
    prefix: string;
    moderationEnabled: boolean;
    musicEnabled: boolean;
    levelingEnabled: boolean;
    economyEnabled: boolean;
}

export default function ServerSettingsPage() {
    const { id } = useParams();
    const { data: session } = useSession();
    const [settings, setSettings] = useState<GuildSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [guildInfo, setGuildInfo] = useState<any>(null);

    useEffect(() => {
        async function fetchData() {
            if (session?.accessToken) {
                try {
                    // Fetch guild info
                    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
                        headers: { Authorization: `Bearer ${session.accessToken}` },
                    });
                    if (guildsRes.ok) {
                        const guilds = await guildsRes.json();
                        const guild = guilds.find((g: any) => g.id === id);
                        setGuildInfo(guild);
                    }

                    // In a real app, fetch from your bot's API
                    // For now, use mock data
                    setSettings({
                        id: id as string,
                        prefix: "!",
                        moderationEnabled: true,
                        musicEnabled: true,
                        levelingEnabled: true,
                        economyEnabled: true,
                    });
                } catch (error) {
                    console.error("Failed to fetch data:", error);
                }
            }
            setLoading(false);
        }
        fetchData();
    }, [session, id]);

    const toggleModule = (module: keyof GuildSettings) => {
        if (settings && typeof settings[module] === "boolean") {
            setSettings({
                ...settings,
                [module]: !settings[module],
            });
        }
    };

    const saveSettings = async () => {
        setSaving(true);
        // In a real app, POST to your bot's API
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setSaving(false);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
        );
    }

    const modules = [
        {
            key: "moderationEnabled",
            name: "Moderation",
            description: "Auto-mod, warnings, kicks, bans, and more",
            icon: Shield,
            color: "from-red-500 to-orange-500",
        },
        {
            key: "musicEnabled",
            name: "Music",
            description: "Play music in voice channels",
            icon: Music,
            color: "from-green-500 to-emerald-500",
        },
        {
            key: "levelingEnabled",
            name: "Leveling",
            description: "XP system with ranks and leaderboards",
            icon: TrendingUp,
            color: "from-blue-500 to-cyan-500",
        },
        {
            key: "economyEnabled",
            name: "Economy",
            description: "Virtual currency, shop, and games",
            icon: Coins,
            color: "from-yellow-500 to-amber-500",
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Header */}
            <div className="bg-gray-800/50 backdrop-blur-lg border-b border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <Link
                        href="/dashboard/servers"
                        className="inline-flex items-center text-gray-400 hover:text-white transition-colors"
                    >
                        <ArrowLeft className="w-5 h-5 mr-2" />
                        Back to Servers
                    </Link>
                </div>
            </div>

            <main className="max-w-4xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                {/* Server Header */}
                <div className="flex items-center space-x-4 mb-8">
                    {guildInfo?.icon ? (
                        <img
                            src={`https://cdn.discordapp.com/icons/${id}/${guildInfo.icon}.png`}
                            alt={guildInfo.name}
                            className="w-16 h-16 rounded-xl"
                        />
                    ) : (
                        <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                            <Settings className="w-8 h-8 text-white" />
                        </div>
                    )}
                    <div>
                        <h1 className="text-3xl font-bold text-white">
                            {guildInfo?.name || "Server Settings"}
                        </h1>
                        <p className="text-gray-400">Configure bot modules and settings</p>
                    </div>
                </div>

                {/* General Settings */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
                    <h2 className="text-xl font-semibold text-white mb-4">General Settings</h2>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Command Prefix
                            </label>
                            <input
                                type="text"
                                value={settings?.prefix || "!"}
                                onChange={(e) =>
                                    settings && setSettings({ ...settings, prefix: e.target.value })
                                }
                                className="w-full max-w-xs px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-purple-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Modules */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 mb-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Modules</h2>
                    <div className="space-y-4">
                        {modules.map((module) => {
                            const enabled = settings?.[module.key as keyof GuildSettings];
                            return (
                                <div
                                    key={module.key}
                                    className="flex items-center justify-between p-4 bg-gray-700/50 rounded-lg"
                                >
                                    <div className="flex items-center space-x-4">
                                        <div
                                            className={`w-10 h-10 bg-gradient-to-br ${module.color} rounded-lg flex items-center justify-center`}
                                        >
                                            <module.icon className="w-5 h-5 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-white">{module.name}</h3>
                                            <p className="text-sm text-gray-400">{module.description}</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => toggleModule(module.key as keyof GuildSettings)}
                                        className="text-2xl"
                                    >
                                        {enabled ? (
                                            <ToggleRight className="w-10 h-10 text-green-500" />
                                        ) : (
                                            <ToggleLeft className="w-10 h-10 text-gray-500" />
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end">
                    <button
                        onClick={saveSettings}
                        disabled={saving}
                        className="inline-flex items-center px-6 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 text-white font-semibold rounded-lg transition-colors"
                    >
                        {saving ? (
                            <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                                Saving...
                            </>
                        ) : (
                            <>
                                <Save className="w-5 h-5 mr-2" />
                                Save Changes
                            </>
                        )}
                    </button>
                </div>
            </main>
        </div>
    );
}
