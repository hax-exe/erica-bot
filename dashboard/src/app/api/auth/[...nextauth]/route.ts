import NextAuth from "next-auth";
import DiscordProvider from "next-auth/providers/discord";

declare module "next-auth" {
    interface Session {
        accessToken?: string;
    }
}

const handler = NextAuth({
    providers: [
        DiscordProvider({
            clientId: process.env.DISCORD_CLIENT_ID!,
            clientSecret: process.env.DISCORD_CLIENT_SECRET!,
            authorization: {
                params: {
                    scope: "identify guilds",
                },
            },
        }),
    ],
    callbacks: {
        async jwt({ token, account }) {
            if (account) {
                token.accessToken = account.access_token;
            }
            return token;
        },
        async session({ session, token }) {
            session.accessToken = token.accessToken as string;
            return session;
        },
    },
});

export { handler as GET, handler as POST };
