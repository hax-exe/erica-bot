/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    eslint: {
        // Ignore ESLint during builds (we run it separately)
        ignoreDuringBuilds: true,
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: 'cdn.discordapp.com',
            },
        ],
    },
};

export default nextConfig;
