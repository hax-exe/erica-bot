"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, Users, MessageSquare, Clock } from "lucide-react";

export default function StatsPage() {
    const { data: session } = useSession();

    // Mock data - in production, fetch from bot API
    const stats = {
        totalServers: 42,
        totalUsers: 15847,
        commandsToday: 1234,
        commandsWeek: 8976,
        uptime: "99.9%",
        topCommands: [
            { name: "/play", count: 2341 },
            { name: "/rank", count: 1876 },
            { name: "/balance", count: 1654 },
            { name: "/help", count: 1432 },
            { name: "/daily", count: 1298 },
        ],
    };

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
                <h1 className="text-3xl font-bold text-white mb-8">Bot Statistics</h1>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                        <div className="flex items-center space-x-3 mb-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                                <Users className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-gray-400">Servers</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats.totalServers}</p>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                        <div className="flex items-center space-x-3 mb-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                                <Users className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-gray-400">Total Users</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats.totalUsers.toLocaleString()}</p>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                        <div className="flex items-center space-x-3 mb-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                                <MessageSquare className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-gray-400">Commands Today</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats.commandsToday.toLocaleString()}</p>
                    </div>

                    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                        <div className="flex items-center space-x-3 mb-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-yellow-500 to-amber-500 rounded-lg flex items-center justify-center">
                                <Clock className="w-5 h-5 text-white" />
                            </div>
                            <span className="text-gray-400">Uptime</span>
                        </div>
                        <p className="text-3xl font-bold text-white">{stats.uptime}</p>
                    </div>
                </div>

                {/* Top Commands */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                    <h2 className="text-xl font-semibold text-white mb-6">Top Commands (7 Days)</h2>
                    <div className="space-y-4">
                        {stats.topCommands.map((cmd, index) => (
                            <div key={cmd.name} className="flex items-center">
                                <span className="w-8 text-gray-500 font-mono">#{index + 1}</span>
                                <span className="flex-1 text-white font-medium">{cmd.name}</span>
                                <div className="flex-1 max-w-md mx-4">
                                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full"
                                            style={{
                                                width: `${(cmd.count / stats.topCommands[0]!.count) * 100}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                                <span className="text-gray-400 font-mono w-16 text-right">
                                    {cmd.count.toLocaleString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Activity Chart Placeholder */}
                <div className="mt-8 bg-gray-800/50 border border-gray-700 rounded-xl p-6">
                    <h2 className="text-xl font-semibold text-white mb-6">Activity (Last 30 Days)</h2>
                    <div className="h-64 flex items-end justify-between gap-1 px-2">
                        {[...Array(30)].map((_, i) => {
                            const height = Math.random() * 80 + 20;
                            return (
                                <div
                                    key={i}
                                    className="flex-1 bg-gradient-to-t from-purple-600 to-purple-400 rounded-t opacity-75 hover:opacity-100 transition-opacity"
                                    style={{ height: `${height}%` }}
                                />
                            );
                        })}
                    </div>
                    <div className="flex justify-between mt-2 text-xs text-gray-500">
                        <span>30 days ago</span>
                        <span>Today</span>
                    </div>
                </div>
            </main>
        </div>
    );
}
