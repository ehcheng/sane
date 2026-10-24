import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock logger before anything else
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    forwardingAddress: {
      count: vi.fn(),
    },
    parent: {
      count: vi.fn(),
    },
    child: {
      count: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

// Mock config: return a minimal config that globalMonitoringStatus needs
vi.mock("@/server/config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    isMonitoringEnabled: true,
    showDebugUI: false,
    brandName: "SANE",
    brandTagline: "School Alerts, Notices & Essentials",
    broadcastActive: false,
    broadcastMessage: null,
    broadcastEndsAt: null,
    lifecycleEnforcementEnabled: false,
  }),
  invalidateConfigCache: vi.fn(),
}));

// Mock lifecycle helpers (used by user.reactivate)
vi.mock("@/server/lifecycle-helpers", () => ({
  getReactivationData: vi.fn().mockReturnValue({
    accountStatus: "ACTIVE",
    deactivatedAt: null,
    lifecycleWarningStage: null,
    lifecycleLastWarnedAt: null,
  }),
}));

// Mock rate-limit (used by user router)
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: vi.fn().mockReturnValue({
    check: vi.fn().mockReturnValue({ allowed: true }),
  }),
}));

import { prisma } from "@/server/db/prisma";
import { auth } from "@/server/auth";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

const mockPrisma = vi.mocked(prisma, true);
const mockAuth = vi.mocked(auth);

// Helper: create a caller that goes through the real middleware
async function callEndpoint<T>(
  endpointFn: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<T>,
): Promise<T> {
  const ctx = await createTRPCContext();
  const caller = appRouter.createCaller(ctx);
  return endpointFn(caller);
}

function setSession(userId: string, role: "USER" | "ADMIN" = "USER") {
  mockAuth.mockResolvedValue({
    user: { id: userId, role, name: "Test User", email: "test@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);
}

// Default mock user returned by the enforceAuth middleware's findUnique
function makeDbUser(overrides: Record<string, unknown> = {}) {
  return {
    householdId: null,
    household: null,
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // Invalidate config cache so each test gets fresh values
  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

// ---------------------------------------------------------------------------
// 1. No session -> UNAUTHORIZED
// ---------------------------------------------------------------------------
describe("no session", () => {
  it("throws UNAUTHORIZED when no session exists", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(
      callEndpoint((c) => c.user.globalMonitoringStatus()),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// 2. Deleted user -> UNAUTHORIZED "Account no longer exists"
// ---------------------------------------------------------------------------
describe("deleted user", () => {
  it("throws UNAUTHORIZED with correct message when user not in DB", async () => {
    setSession("deleted-user-id");
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      callEndpoint((c) => c.user.globalMonitoringStatus()),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Account no longer exists.",
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Solo user (no household) -> ctx.userId = session user ID, isHouseholdOwner = true
// ---------------------------------------------------------------------------
describe("solo user", () => {
  it("resolves ctx.userId to the session user and isHouseholdOwner = true", async () => {
    const userId = "solo-user-id";
    setSession(userId);

    // Middleware findUnique: solo user (no household)
    mockPrisma.user.findUnique.mockResolvedValue(makeDbUser() as any);

    // user.me endpoint: findUniqueOrThrow for the solo/owner path
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      id: userId,
      email: "solo@test.com",
      pendingEmail: null,
      name: "Solo User",
      role: "USER",
      emailVerified: new Date(),
      wizardStep: 3,
      feedbackTrainingConsent: "denied",
      supportDataConsent: false,
      supportDataConsentExpiresAt: null,
      completedTours: "[]",
      timezone: "America/New_York",
      createdAt: new Date(),
      accountStatus: "ACTIVE",
      deactivatedAt: null,
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      defaultEventsView: "agenda",
      actionableEventsOnly: false,
      isMonitoringEnabled: true,
      forwardingMode: "INDIVIDUAL",
      emailFilterMode: "ALL",
      showLinksInSummary: true,
      emailAccountType: "DEDICATED",
      brutalMode: false,
    } as any);

    const result = await callEndpoint((c) => c.user.me());

    // The me endpoint should have queried for the session user's own ID
    expect(mockPrisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: userId } }),
    );
    // isHouseholdOwner should be true for solo users
    expect(result.isHouseholdOwner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Household member -> ctx.userId resolves to primaryUserId
// ---------------------------------------------------------------------------
describe("household member", () => {
  it("resolves ctx.userId to the primary user ID", async () => {
    const memberId = "member-user-id";
    const primaryId = "primary-user-id";
    setSession(memberId);

    // Middleware findUnique: household member
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        householdId: "household-1",
        household: {
          primaryUserId: primaryId,
          primaryUser: { accountStatus: "ACTIVE" },
        },
      }) as any,
    );

    // user.me endpoint: partner path does two parallel findUniqueOrThrow calls
    const perUserData = {
      id: memberId,
      email: "member@test.com",
      pendingEmail: null,
      name: "Member User",
      role: "USER",
      emailVerified: new Date(),
      wizardStep: 3,
      feedbackTrainingConsent: "denied",
      supportDataConsent: false,
      supportDataConsentExpiresAt: null,
      completedTours: "[]",
      timezone: "America/New_York",
      createdAt: new Date(),
      accountStatus: "ACTIVE",
      deactivatedAt: null,
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      defaultEventsView: "agenda",
      actionableEventsOnly: false,
    };
    const sharedData = {
      isMonitoringEnabled: true,
      forwardingMode: "INDIVIDUAL",
      emailFilterMode: "ALL",
      showLinksInSummary: true,
      emailAccountType: "DEDICATED",
      brutalMode: false,
    };

    // First call: own user (perUser), second call: primary user (shared)
    mockPrisma.user.findUniqueOrThrow
      .mockResolvedValueOnce(perUserData as any)
      .mockResolvedValueOnce(sharedData as any);

    const result = await callEndpoint((c) => c.user.me());

    // The partner path should query authUserId (member) and userId (primary)
    expect(mockPrisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: memberId } }),
    );
    expect(mockPrisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: primaryId } }),
    );
    // Household member is not the owner
    expect(result.isHouseholdOwner).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Household owner -> ctx.userId = own ID, isHouseholdOwner = true
// ---------------------------------------------------------------------------
describe("household owner", () => {
  it("resolves ctx.userId to own ID and isHouseholdOwner = true", async () => {
    const ownerId = "owner-user-id";
    setSession(ownerId);

    // Middleware findUnique: household owner (primaryUserId matches session)
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({
        householdId: "household-1",
        household: {
          primaryUserId: ownerId,
          primaryUser: { accountStatus: "ACTIVE" },
        },
      }) as any,
    );

    // user.me endpoint: owner path (not partner), single findUniqueOrThrow
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      id: ownerId,
      email: "owner@test.com",
      pendingEmail: null,
      name: "Owner User",
      role: "USER",
      emailVerified: new Date(),
      wizardStep: 3,
      feedbackTrainingConsent: "denied",
      supportDataConsent: false,
      supportDataConsentExpiresAt: null,
      completedTours: "[]",
      timezone: "America/New_York",
      createdAt: new Date(),
      accountStatus: "ACTIVE",
      deactivatedAt: null,
      individualForwardingEnabled: true,
      dailyBriefEnabled: true,
      weeklyBriefEnabled: true,
      defaultEventsView: "agenda",
      actionableEventsOnly: false,
      isMonitoringEnabled: true,
      forwardingMode: "INDIVIDUAL",
      emailFilterMode: "ALL",
      showLinksInSummary: true,
      emailAccountType: "DEDICATED",
      brutalMode: false,
    } as any);

    const result = await callEndpoint((c) => c.user.me());

    // Should query for the owner's own ID (effectiveUserId = ownerId)
    expect(mockPrisma.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ownerId } }),
    );
    expect(result.isHouseholdOwner).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Deactivated user on protectedProcedure -> FORBIDDEN "ACCOUNT_DEACTIVATED"
// ---------------------------------------------------------------------------
describe("deactivated user on protectedProcedure", () => {
  it("throws FORBIDDEN with ACCOUNT_DEACTIVATED message", async () => {
    setSession("deactivated-user-id");
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ accountStatus: "DEACTIVATED" }) as any,
    );

    // user.statusSummary uses protectedProcedure
    await expect(
      callEndpoint((c) => c.user.statusSummary()),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "ACCOUNT_DEACTIVATED",
    });
  });
});

// ---------------------------------------------------------------------------
// 7. Deactivated user on deactivatedAllowedProcedure -> succeeds
// ---------------------------------------------------------------------------
describe("deactivated user on deactivatedAllowedProcedure", () => {
  it("allows access to user.me for deactivated users", async () => {
    const userId = "deactivated-user-id";
    setSession(userId);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ accountStatus: "DEACTIVATED" }) as any,
    );

    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      id: userId,
      email: "deactivated@test.com",
      pendingEmail: null,
      name: "Deactivated User",
      role: "USER",
      emailVerified: new Date(),
      wizardStep: 3,
      feedbackTrainingConsent: "denied",
      supportDataConsent: false,
      supportDataConsentExpiresAt: null,
      completedTours: "[]",
      timezone: "America/New_York",
      createdAt: new Date(),
      accountStatus: "DEACTIVATED",
      deactivatedAt: new Date(),
      individualForwardingEnabled: false,
      dailyBriefEnabled: false,
      weeklyBriefEnabled: false,
      defaultEventsView: "agenda",
      actionableEventsOnly: false,
      isMonitoringEnabled: false,
      forwardingMode: "INDIVIDUAL",
      emailFilterMode: "ALL",
      showLinksInSummary: true,
      emailAccountType: "DEDICATED",
      brutalMode: false,
    } as any);

    // Should NOT throw
    const result = await callEndpoint((c) => c.user.me());
    expect(result.accountStatus).toBe("DEACTIVATED");
  });

  it("allows access to user.reactivate for deactivated users", async () => {
    const userId = "deactivated-user-id";
    setSession(userId);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ accountStatus: "DEACTIVATED" }) as any,
    );

    // reactivate calls findUniqueOrThrow to verify status
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      accountStatus: "DEACTIVATED",
    } as any);
    mockPrisma.user.update.mockResolvedValue({} as any);

    const result = await callEndpoint((c) => c.user.reactivate());
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. primaryDeactivated detection via globalMonitoringStatus
// ---------------------------------------------------------------------------
describe("primaryDeactivated detection", () => {
  it("sets primaryDeactivated = true when primary is DEACTIVATED", async () => {
    const memberId = "member-id";
    const primaryId = "primary-id";
    setSession(memberId);

    // Middleware: member whose primary is deactivated
    mockPrisma.user.findUnique.mockImplementation(((args: { where: { id: string } }) => {
      if (args.where.id === memberId) {
        // First call from middleware
        return Promise.resolve(
          makeDbUser({
            householdId: "household-1",
            household: {
              primaryUserId: primaryId,
              primaryUser: { accountStatus: "DEACTIVATED" },
            },
          }),
        );
      }
      // globalMonitoringStatus also calls findUnique for debugToolsEnabled
      return Promise.resolve({ debugToolsEnabled: false });
    }) as any);

    const result = await callEndpoint((c) => c.user.globalMonitoringStatus());
    expect(result.primaryDeactivated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Activity tracking: stale lastActiveAt -> prisma.user.update called
// ---------------------------------------------------------------------------
describe("activity tracking", () => {
  it("updates lastActiveAt when stale (>1 hour)", async () => {
    const userId = "active-user-id";
    setSession(userId);

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    mockPrisma.user.findUnique.mockResolvedValue(
      makeDbUser({ lastActiveAt: twoHoursAgo }) as any,
    );

    // For globalMonitoringStatus endpoint (simpler than user.me)
    // It also calls findUnique for debugToolsEnabled, but our mock returns the
    // same value for all calls. We need to handle both calls.
    mockPrisma.user.findUnique.mockImplementation(((args: { where: { id: string }; select: Record<string, unknown> }) => {
      if (args.select && "debugToolsEnabled" in args.select) {
        return Promise.resolve({ debugToolsEnabled: false });
      }
      // Middleware call
      return Promise.resolve(makeDbUser({ lastActiveAt: twoHoursAgo }));
    }) as any);

    mockPrisma.user.update.mockResolvedValue({} as any);

    await callEndpoint((c) => c.user.globalMonitoringStatus());

    // trackActivity should have fired a fire-and-forget update
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: userId },
        data: { lastActiveAt: expect.any(Date) },
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // 10. Activity tracking throttle: recent lastActiveAt -> no update
  // ---------------------------------------------------------------------------
  it("does NOT update lastActiveAt when recent (<1 hour)", async () => {
    const userId = "active-user-id";
    setSession(userId);

    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    mockPrisma.user.findUnique.mockImplementation(((args: { where: { id: string }; select: Record<string, unknown> }) => {
      if (args.select && "debugToolsEnabled" in args.select) {
        return Promise.resolve({ debugToolsEnabled: false });
      }
      return Promise.resolve(makeDbUser({ lastActiveAt: tenMinutesAgo }));
    }) as any);

    await callEndpoint((c) => c.user.globalMonitoringStatus());

    // Should NOT have called update for activity tracking
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
