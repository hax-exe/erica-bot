"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Bot, ArrowLeft, Users, MessageSquare, Shield, Music } from "lucide-react";

interface Guild {
    id: string;
    name: string;
    icon: string | null;
    owner: boolean;
    permissions: string;
    features: string[];
}

export default function ServersPage() {
    const { data: session } = useSession();
    const [guilds, setGuilds] = useState<Guild[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchGuilds() {
            if (session?.accessToken) {
                try {
                    const response = await fetch("https://discord.com/api/users/@me/guilds", {
                        headers: {
                            Authorization: `Bearer ${session.accessToken}`,
                        },
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Filter to guilds where user can manage (has MANAGE_GUILD permission)
                        const manageable = data.filter(
                            (g: Guild) => (parseInt(g.permissions) & 0x20) === 0x20 || g.owner
                        );
                        setGuilds(manageable);
                    }
                } catch (error) {
                    console.error("Failed to fetch guilds:", error);
                }
            }
            setLoading(false);
        }
        fetchGuilds();
    }, [session]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
            {/* Header */}
            <div className="bg-gray-800/50 backdrop-blur-lg border-b border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
                    <Link href="/" className="inline-flex items-center text-gray-400 hover:text-white transition-colors">
                        <ArrowLeft className="w-5 h-5 mr-2" />
                        Back to Dashboard
                    </Link>
                </div>
            </div>

            <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
                <h1 className="text-3xl font-bold text-white mb-2">Select a Server</h1>
                <p className="text-gray-400 mb-8">Choose a server to configure the bot settings</p>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {guilds.map((guild) => (
                        <Link
                            key={guild.id}
                            href={`/dashboard/servers/${guild.id}`}
                            className="group"
                        >
                            <div className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700 rounded-xl p-6 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
                                <div className="flex items-center space-x-4">
                                    {guild.icon ? (
                                        <img
                                            src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`}
                                            alt={guild.name}
                                            className="w-14 h-14 rounded-xl"
                                        />
                                    ) : (
                                        <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                                            <span className="text-xl font-bold text-white">
                                                {guild.name.charAt(0)}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="text-lg font-semibold text-white truncate">
                                            {guild.name}
                                        </h3>
                                        <p className="text-sm text-gray-400">
                                            {guild.owner ? "Owner" : "Admin"}
                                        </p>
                                    </div>
                                    <span className="text-gray-400 group-hover:text-purple-400 transition-colors">→</span>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>

                {guilds.length === 0 && (
                    <div className="text-center py-12">
                        <Bot className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-white mb-2">No Servers Found</h3>
                        <p className="text-gray-400">
                            You don&apos;t have admin access to any servers with the bot.
                        </p>
                    </div>
                )}
            </main>
        </div>
    );
}
