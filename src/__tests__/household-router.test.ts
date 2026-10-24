import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Mocks (vi.mock is hoisted)
// ---------------------------------------------------------------------------

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    household: {
      create: vi.fn(),
      delete: vi.fn(),
    },
    householdInvite: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    extractedEvent: { deleteMany: vi.fn() },
    processedEmail: { deleteMany: vi.fn() },
    child: { deleteMany: vi.fn() },
    parent: { deleteMany: vi.fn() },
    ignoredActivity: { deleteMany: vi.fn() },
    priorityActivity: { deleteMany: vi.fn() },
    senderRule: { deleteMany: vi.fn() },
    allowedSender: { deleteMany: vi.fn() },
    feedbackSnapshot: { deleteMany: vi.fn() },
    userFeedback: { deleteMany: vi.fn() },
    briefDelivery: { deleteMany: vi.fn() },
    processedEmailDailyStats: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/hmac-token", () => ({
  signToken: vi.fn().mockReturnValue("hmac-signed-token"),
  verifyToken: vi.fn(),
}));

vi.mock("@/server/email/sender", () => ({
  sendHouseholdInviteEmail: vi.fn().mockResolvedValue(undefined),
  sendHouseholdDepartureEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/server/config", () => ({
  getConfig: vi.fn().mockResolvedValue({}),
  invalidateConfigCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { prisma } from "@/server/db/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { auth } from "@/server/auth";
import { verifyToken } from "@/lib/hmac-token";

const mockPrisma = vi.mocked(prisma, true);
const mockAuth = vi.mocked(auth);
const mockVerifyToken = vi.mocked(verifyToken);

// ---------------------------------------------------------------------------
// Helper: create a caller with a given role
// ---------------------------------------------------------------------------

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const PARTNER_ID = "00000000-0000-0000-0000-000000000002";
const HOUSEHOLD_ID = "00000000-0000-0000-0000-000000000010";

async function callAs(userId: string, fn: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>) {
  mockAuth.mockResolvedValue({
    user: { id: userId, role: "USER", name: "Test", email: `${userId}@test.com` },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);
  const ctx = await createTRPCContext();
  const caller = appRouter.createCaller(ctx);
  return fn(caller);
}

// ---------------------------------------------------------------------------
// Default mock setup for enforceAuth middleware
// ---------------------------------------------------------------------------

function setupAuthMiddleware(userId: string, opts?: { householdId?: string | null; primaryUserId?: string | null }) {
  const householdId = opts?.householdId ?? null;
  const primaryUserId = opts?.primaryUserId ?? null;

  // protectedProcedure middleware calls prisma.user.findUnique
  mockPrisma.user.findUnique.mockResolvedValue({
    householdId,
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
    household: householdId
      ? { primaryUserId: primaryUserId ?? userId }
      : null,
  } as any);
}

function setupHouseholdOwnerMiddleware() {
  // householdOwnerProcedure calls prisma.user.findUniqueOrThrow
  mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
    householdId: HOUSEHOLD_ID,
    name: "Owner",
    email: "owner@test.com",
    household: {
      id: HOUSEHOLD_ID,
      primaryUserId: OWNER_ID,
      members: [
        { id: OWNER_ID, name: "Owner", email: "owner@test.com" },
        { id: PARTNER_ID, name: "Partner", email: "partner@test.com" },
      ],
    },
  } as any);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("household.status", () => {
  it("returns household members and pending invites for a household member", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    // status calls prisma.user.findUniqueOrThrow for its own query
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      email: "owner@test.com",
      householdId: HOUSEHOLD_ID,
      household: {
        id: HOUSEHOLD_ID,
        primaryUserId: OWNER_ID,
        createdAt: new Date("2026-01-01"),
        members: [
          { id: OWNER_ID, name: "Owner", email: "owner@test.com" },
          { id: PARTNER_ID, name: "Partner", email: "partner@test.com" },
        ],
        invites: [
          { id: "inv-1", email: "pending@test.com", createdAt: new Date(), expiresAt: new Date() },
        ],
      },
    } as any);

    const result = await callAs(OWNER_ID, (c) => c.household.status());

    expect(result).toMatchObject({
      inHousehold: true,
      isPrimary: true,
      household: {
        id: HOUSEHOLD_ID,
        members: expect.arrayContaining([
          expect.objectContaining({ id: PARTNER_ID }),
        ]),
        pendingInvites: expect.arrayContaining([
          expect.objectContaining({ email: "pending@test.com" }),
        ]),
      },
    });
  });
});

describe("household.create", () => {
  it("creates household and updates user's householdId", async () => {
    setupAuthMiddleware(OWNER_ID);

    // create calls findUniqueOrThrow to check existing household
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      householdId: null,
    } as any);
    mockPrisma.household.create.mockResolvedValue({
      id: HOUSEHOLD_ID,
    } as any);

    const result = await callAs(OWNER_ID, (c) => c.household.create());

    expect(result).toEqual({ householdId: HOUSEHOLD_ID });
    expect(mockPrisma.household.create).toHaveBeenCalledWith({
      data: {
        primaryUserId: OWNER_ID,
        members: { connect: { id: OWNER_ID } },
      },
    });
  });

  it("rejects if already in a household", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      householdId: HOUSEHOLD_ID,
    } as any);

    await expect(
      callAs(OWNER_ID, (c) => c.household.create()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("household.invite", () => {
  it("generates HMAC-signed invite link", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });
    setupHouseholdOwnerMiddleware();

    mockPrisma.householdInvite.findFirst.mockResolvedValue(null); // no existing invite
    mockPrisma.householdInvite.create.mockResolvedValue({ id: "inv-new" } as any);

    const result = await callAs(OWNER_ID, (c) =>
      c.household.invite({ email: "partner@test.com" }),
    );

    expect(result).toEqual({ inviteId: "inv-new" });
    const { signToken } = await import("@/lib/hmac-token");
    expect(signToken).toHaveBeenCalledWith(
      { householdId: HOUSEHOLD_ID, email: "partner@test.com" },
      7,
      "household-invite",
    );
  });

  it("rejects if at 6-member limit", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    // Override householdOwnerProcedure to return 6 members
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      householdId: HOUSEHOLD_ID,
      name: "Owner",
      email: "owner@test.com",
      household: {
        id: HOUSEHOLD_ID,
        primaryUserId: OWNER_ID,
        members: Array.from({ length: 6 }, (_, i) => ({
          id: `member-${i}`,
          name: `Member ${i}`,
          email: `m${i}@test.com`,
        })),
      },
    } as any);

    await expect(
      callAs(OWNER_ID, (c) => c.household.invite({ email: "extra@test.com" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("household.acceptInvite", () => {
  it("valid token joins household and deletes standalone data", async () => {
    setupAuthMiddleware(PARTNER_ID);

    mockVerifyToken.mockReturnValue({ householdId: HOUSEHOLD_ID, email: "partner@test.com" });

    // invite record exists
    mockPrisma.householdInvite.findFirst.mockResolvedValue({
      id: "inv-1",
      householdId: HOUSEHOLD_ID,
      email: "partner@test.com",
    } as any);

    // joining user lookup
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      id: PARTNER_ID,
      email: "partner@test.com",
      householdId: null,
    } as any);

    mockPrisma.$transaction.mockResolvedValue(undefined);

    const result = await callAs(PARTNER_ID, (c) =>
      c.household.acceptInvite({ token: "valid-token" }),
    );

    expect(result).toEqual({ success: true, householdId: HOUSEHOLD_ID });
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    // Verify the transaction array includes deleteMany calls for standalone data
    const txArg = mockPrisma.$transaction.mock.calls[0][0] as any[];
    // Should have 14 operations (12 deleteManyS + invite update + user update)
    expect(txArg.length).toBe(14);
  });

  it("expired/invalid token throws", async () => {
    setupAuthMiddleware(PARTNER_ID);
    mockVerifyToken.mockReturnValue(null);

    await expect(
      callAs(PARTNER_ID, (c) => c.household.acceptInvite({ token: "bad-token" })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("household.leave", () => {
  it("non-owner can leave, resets wizardStep to 0", async () => {
    setupAuthMiddleware(PARTNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    // leave calls findUniqueOrThrow for the leaving user
    mockPrisma.user.findUniqueOrThrow
      .mockResolvedValueOnce({
        name: "Partner",
        email: "partner@test.com",
        householdId: HOUSEHOLD_ID,
        household: { primaryUserId: OWNER_ID },
      } as any)
      // Then for the owner (notification)
      .mockResolvedValueOnce({
        name: "Owner",
        email: "owner@test.com",
      } as any);

    mockPrisma.user.update.mockResolvedValue({} as any);

    const result = await callAs(PARTNER_ID, (c) => c.household.leave());

    expect(result).toEqual({ success: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: PARTNER_ID },
      data: { householdId: null, wizardStep: 0, completedTours: "[]" },
    });
  });

  it("owner cannot leave (must dissolve)", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      name: "Owner",
      email: "owner@test.com",
      householdId: HOUSEHOLD_ID,
      household: { primaryUserId: OWNER_ID },
    } as any);

    await expect(
      callAs(OWNER_ID, (c) => c.household.leave()),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("household.removeMember", () => {
  it("owner can remove a partner", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    // First call: householdOwnerProcedure middleware
    // Second call: removeMember handler looks up the target member
    mockPrisma.user.findUniqueOrThrow
      .mockResolvedValueOnce({
        householdId: HOUSEHOLD_ID,
        name: "Owner",
        email: "owner@test.com",
        household: {
          id: HOUSEHOLD_ID,
          primaryUserId: OWNER_ID,
          members: [
            { id: OWNER_ID, name: "Owner", email: "owner@test.com" },
            { id: PARTNER_ID, name: "Partner", email: "partner@test.com" },
          ],
        },
      } as any)
      .mockResolvedValueOnce({
        name: "Partner",
        email: "partner@test.com",
      } as any);
    mockPrisma.user.update.mockResolvedValue({} as any);

    const result = await callAs(OWNER_ID, (c) =>
      c.household.removeMember({ userId: PARTNER_ID }),
    );

    expect(result).toEqual({ success: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: PARTNER_ID },
      data: { householdId: null, wizardStep: 0, completedTours: "[]" },
    });
  });
});

describe("household.dissolve", () => {
  it("deletes household and resets members' wizardStep", async () => {
    setupAuthMiddleware(OWNER_ID, { householdId: HOUSEHOLD_ID, primaryUserId: OWNER_ID });

    // householdOwnerProcedure middleware calls findUniqueOrThrow
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      householdId: HOUSEHOLD_ID,
      name: "Owner",
      email: "owner@test.com",
      household: {
        id: HOUSEHOLD_ID,
        primaryUserId: OWNER_ID,
        members: [
          { id: OWNER_ID, name: "Owner", email: "owner@test.com" },
          { id: PARTNER_ID, name: "Partner", email: "partner@test.com" },
        ],
      },
    } as any);

    mockPrisma.$transaction.mockResolvedValue(undefined);

    const result = await callAs(OWNER_ID, (c) => c.household.dissolve());

    expect(result).toEqual({ success: true });
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    // Verify the transaction includes household deletion
    const txArg = mockPrisma.$transaction.mock.calls[0][0] as any[];
    expect(txArg.length).toBe(4); // owner update, members updateMany, invites deleteMany, household delete
  });
});
