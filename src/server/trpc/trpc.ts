import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import type { AccountStatus } from "@prisma/client";
import { trackActivity } from "@/server/activity-tracker";

export const createTRPCContext = async () => {
  const session = await auth();
  return { session };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const userSelect = {
  householdId: true,
  accountStatus: true,
  lastActiveAt: true,
  household: {
    select: {
      primaryUserId: true,
      primaryUser: { select: { accountStatus: true } },
    },
  },
} as const;

interface AuthUserRow {
  householdId: string | null;
  accountStatus: AccountStatus;
  lastActiveAt: Date | null;
  household: {
    primaryUserId: string;
    primaryUser: { accountStatus: AccountStatus };
  } | null;
}

function resolveAuthContext(dbUser: AuthUserRow, sessionUserId: string) {
  const effectiveUserId = dbUser.household?.primaryUserId ?? sessionUserId;
  const primaryDeactivated =
    dbUser.householdId != null &&
    effectiveUserId !== sessionUserId &&
    dbUser.household?.primaryUser?.accountStatus === "DEACTIVATED";

  return {
    userId: effectiveUserId,
    authUserId: sessionUserId,
    householdId: dbUser.householdId,
    isHouseholdOwner: !dbUser.householdId || effectiveUserId === sessionUserId,
    accountStatus: dbUser.accountStatus,
    primaryDeactivated,
  };
}

// trackActivity is imported from @/server/activity-tracker (shared with calendar route)

function createAuthMiddleware(allowDeactivated: boolean) {
  return t.middleware(async ({ ctx, next }) => {
    if (!ctx.session?.user?.id) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: ctx.session.user.id },
      select: userSelect,
    });
    if (!dbUser) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Account no longer exists." });
    }

    if (!allowDeactivated && dbUser.accountStatus === "DEACTIVATED") {
      throw new TRPCError({ code: "FORBIDDEN", message: "ACCOUNT_DEACTIVATED" });
    }

    trackActivity(ctx.session.user.id, dbUser.lastActiveAt);

    return next({
      ctx: {
        session: ctx.session,
        ...resolveAuthContext(dbUser, ctx.session.user.id),
      },
    });
  });
}

export const protectedProcedure = t.procedure.use(createAuthMiddleware(false));
export const deactivatedAllowedProcedure = t.procedure.use(createAuthMiddleware(true));

const enforceAdmin = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session?.user?.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  // Re-verify admin role from DB (JWT role could be stale for up to 7 days)
  const dbUser = await prisma.user.findUnique({
    where: { id: ctx.session.user.id },
    select: { role: true },
  });
  if (!dbUser || dbUser.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }

  // Admin uses their own ID (not household-scoped).
  // Include safe defaults for context fields that protectedProcedure normally sets,
  // so downstream code doesn't get undefined if it reads these fields.
  return next({
    ctx: {
      session: ctx.session,
      userId: ctx.session.user.id,
      authUserId: ctx.session.user.id,
      householdId: null,
      isHouseholdOwner: true,
      accountStatus: "ACTIVE" as AccountStatus,
      primaryDeactivated: false,
    },
  });
});

export const adminProcedure = t.procedure.use(enforceAdmin);

/** Requires the caller to be the primary (owner) of a household. */
const enforceHouseholdOwner = t.middleware(async ({ ctx, next }) => {
  // enforceAuth already ran (this chains after protectedProcedure).
  const authUserId = (ctx as unknown as { authUserId: string }).authUserId;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authUserId },
    select: {
      householdId: true,
      name: true,
      email: true,
      household: {
        select: {
          id: true,
          primaryUserId: true,
          members: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (!user.householdId || !user.household) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "You are not in a household." });
  }
  if (user.household.primaryUserId !== authUserId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only the household owner can do this." });
  }

  return next({
    ctx: {
      ...ctx,
      household: user.household,
      ownerName: user.name,
      ownerEmail: user.email,
    },
  });
});

export const householdOwnerProcedure = protectedProcedure.use(enforceHouseholdOwner);

// Re-export type for context consumers
export type { AccountStatus };
