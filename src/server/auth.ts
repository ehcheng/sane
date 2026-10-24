import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { prisma } from "@/server/db/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
  pages: {
    signIn: "/login",
    newUser: "/setup",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await prisma.user.findFirst({
          where: { email: { equals: credentials.email as string, mode: "insensitive" } },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "USER" | "ADMIN" }).role ?? "USER";
      }

      // Resolve effectiveUserId on sign-in and on explicit session updates
      // (e.g. after joining or leaving a household).
      if (user || trigger === "update") {
        const userId = (user?.id ?? token.id) as string;
        const dbUser = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            householdId: true,
            household: { select: { primaryUserId: true } },
          },
        });
        token.householdId = dbUser?.householdId ?? null;
        token.effectiveUserId = dbUser?.household?.primaryUserId ?? userId;

        // Track login activity (fire-and-forget)
        if (user) {
          prisma.user
            .update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
            .catch(() => {});
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        session.user.role = (token.role as "USER" | "ADMIN") ?? "USER";
        session.user.effectiveUserId = (token.effectiveUserId ?? token.id) as string;
        session.user.householdId = token.householdId as string | null | undefined;
      }
      return session;
    },
  },
});
