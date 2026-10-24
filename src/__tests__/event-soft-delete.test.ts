import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    extractedEvent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
    },
    child: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/server/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/pii-encryption", () => ({
  decryptChildRecord: vi.fn().mockImplementation((c: any) =>
    Promise.resolve({ ...c, name: "Child" })
  ),
}));

import { prisma } from "@/server/db/prisma";
import { auth } from "@/server/auth";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

const mockPrisma = vi.mocked(prisma, true);
const mockAuth = vi.mocked(auth);

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const TEST_EVENT_ID = "00000000-0000-0000-0000-000000000099";

async function callAs(fn: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>) {
  mockAuth.mockResolvedValue({
    user: { id: TEST_USER_ID, role: "USER", name: "Test User", email: "test@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);
  // Mock the middleware's user lookup
  mockPrisma.user.findUnique.mockResolvedValue({
    id: TEST_USER_ID,
    role: "USER",
    lastActiveAt: new Date(),
    householdId: null,
    household: null,
  } as any);
  const ctx = await createTRPCContext();
  const caller = appRouter.createCaller(ctx);
  return fn(caller);
}

function p2025Error(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(
    "An operation failed because it depends on one or more records that were required but not found.",
    { code: "P2025", clientVersion: "5.0.0" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("event soft-delete", () => {
  // -------------------------------------------------------------------
  // 1. Delete sets deletedAt instead of removing
  // -------------------------------------------------------------------
  it("sets deletedAt instead of hard-deleting", async () => {
    mockPrisma.extractedEvent.update.mockResolvedValue({ id: TEST_EVENT_ID } as any);

    await callAs((caller) => caller.events.delete({ id: TEST_EVENT_ID }));

    expect(mockPrisma.extractedEvent.update).toHaveBeenCalledWith({
      where: { id: TEST_EVENT_ID, userId: TEST_USER_ID, deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    // Hard delete should NOT be called
    expect(mockPrisma.extractedEvent.delete).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // 2. Double-delete returns NOT_FOUND (not 500)
  // -------------------------------------------------------------------
  it("returns NOT_FOUND when deleting an already-deleted event", async () => {
    mockPrisma.extractedEvent.update.mockRejectedValue(p2025Error());

    await expect(
      callAs((caller) => caller.events.delete({ id: TEST_EVENT_ID }))
    ).rejects.toThrow(TRPCError);

    await expect(
      callAs((caller) => caller.events.delete({ id: TEST_EVENT_ID }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // 3. Update rejects soft-deleted events with NOT_FOUND
  // -------------------------------------------------------------------
  it("returns NOT_FOUND when updating a soft-deleted event", async () => {
    mockPrisma.extractedEvent.update.mockRejectedValue(p2025Error());

    await expect(
      callAs((caller) =>
        caller.events.update({ id: TEST_EVENT_ID, title: "New Title" })
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // 4. markDone rejects soft-deleted events with NOT_FOUND
  // -------------------------------------------------------------------
  it("returns NOT_FOUND when marking a soft-deleted event as done", async () => {
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ name: "Test" } as any);
    mockPrisma.extractedEvent.update.mockRejectedValue(p2025Error());

    await expect(
      callAs((caller) => caller.events.markDone({ id: TEST_EVENT_ID }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // 5. unmarkDone rejects soft-deleted events with NOT_FOUND
  // -------------------------------------------------------------------
  it("returns NOT_FOUND when unmarking a soft-deleted event", async () => {
    mockPrisma.extractedEvent.update.mockRejectedValue(p2025Error());

    await expect(
      callAs((caller) => caller.events.unmarkDone({ id: TEST_EVENT_ID }))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // 6. submitEventFeedback rejects soft-deleted events
  // -------------------------------------------------------------------
  it("returns NOT_FOUND when submitting feedback on a soft-deleted event", async () => {
    mockPrisma.extractedEvent.findUnique.mockResolvedValue(null);

    await expect(
      callAs((caller) =>
        caller.events.submitEventFeedback({
          eventId: TEST_EVENT_ID,
          feedback: "correct",
        })
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // -------------------------------------------------------------------
  // 7. list excludes soft-deleted events (deletedAt: null in where)
  // -------------------------------------------------------------------
  it("list query includes deletedAt: null filter", async () => {
    mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
    mockPrisma.extractedEvent.count.mockResolvedValue(0);

    await callAs((caller) =>
      caller.events.list({
        startDate: "2026-05-01T00:00:00.000Z",
        endDate: "2026-05-31T23:59:59.999Z",
      })
    );

    expect(mockPrisma.extractedEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      })
    );
  });

  // -------------------------------------------------------------------
  // 8. Non-P2025 errors propagate normally (not swallowed)
  // -------------------------------------------------------------------
  it("propagates non-P2025 errors from update", async () => {
    mockPrisma.extractedEvent.update.mockRejectedValue(new Error("DB connection lost"));

    await expect(
      callAs((caller) => caller.events.delete({ id: TEST_EVENT_ID }))
    ).rejects.toThrow("DB connection lost");
  });
});
