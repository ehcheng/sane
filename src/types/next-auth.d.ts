import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "USER" | "ADMIN";
      /** Resolves to household primaryUserId if in a household, otherwise own id */
      effectiveUserId: string;
      householdId?: string | null;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: "USER" | "ADMIN";
    effectiveUserId?: string;
    householdId?: string | null;
  }
}
