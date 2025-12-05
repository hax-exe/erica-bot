"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import { Bot, LogOut, Settings, BarChart3, Shield } from "lucide-react";

export default function Home() {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex flex-col items-center justify-center">
        <div className="text-center space-y-8">
          <div className="flex items-center justify-center space-x-3">
            <Bot className="w-16 h-16 text-purple-400" />
            <h1 className="text-5xl font-bold text-white">Bot Dashboard</h1>
          </div>
          <p className="text-xl text-gray-300 max-w-md">
            Manage your Discord bot settings, view statistics, and configure modules.
          </p>
          <button
            onClick={() => signIn("discord")}
            className="inline-flex items-center px-8 py-4 bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold rounded-lg transition-all transform hover:scale-105 shadow-lg hover:shadow-purple-500/25"
          >
            <svg className="w-6 h-6 mr-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Login with Discord
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      {/* Navigation */}
      <nav className="bg-gray-800/50 backdrop-blur-lg border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <Bot className="w-8 h-8 text-purple-400" />
              <span className="text-xl font-bold text-white">Dashboard</span>
            </div>
            <div className="flex items-center space-x-4">
              <span className="text-gray-300">
                Welcome, <span className="text-purple-400">{session.user?.name}</span>
              </span>
              <button
                onClick={() => signOut()}
                className="p-2 text-gray-400 hover:text-white transition-colors"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-white mb-8">Your Servers</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Placeholder for servers - would fetch from Discord API */}
          <Link href="/dashboard/servers" className="group">
            <div className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700 rounded-xl p-6 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center">
                  <Settings className="w-6 h-6 text-white" />
                </div>
                <span className="text-gray-400 group-hover:text-purple-400 transition-colors">→</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Manage Servers</h3>
              <p className="text-gray-400 text-sm">Configure bot settings for your servers</p>
            </div>
          </Link>

          <Link href="/dashboard/stats" className="group">
            <div className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700 rounded-xl p-6 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-xl flex items-center justify-center">
                  <BarChart3 className="w-6 h-6 text-white" />
                </div>
                <span className="text-gray-400 group-hover:text-purple-400 transition-colors">→</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Statistics</h3>
              <p className="text-gray-400 text-sm">View bot usage and server analytics</p>
            </div>
          </Link>

          <Link href="/dashboard/moderation" className="group">
            <div className="bg-gray-800/50 hover:bg-gray-800 border border-gray-700 rounded-xl p-6 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
              <div className="flex items-center justify-between mb-4">
                <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
                  <Shield className="w-6 h-6 text-white" />
                </div>
                <span className="text-gray-400 group-hover:text-purple-400 transition-colors">→</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Moderation</h3>
              <p className="text-gray-400 text-sm">Configure auto-mod and view logs</p>
            </div>
          </Link>
        </div>

        {/* Quick Stats */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-white mb-6">Quick Stats</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
              <p className="text-gray-400 text-sm">Total Servers</p>
              <p className="text-3xl font-bold text-white mt-2">--</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
              <p className="text-gray-400 text-sm">Total Users</p>
              <p className="text-3xl font-bold text-white mt-2">--</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
              <p className="text-gray-400 text-sm">Commands Today</p>
              <p className="text-3xl font-bold text-white mt-2">--</p>
            </div>
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
              <p className="text-gray-400 text-sm">Uptime</p>
              <p className="text-3xl font-bold text-white mt-2">--</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
