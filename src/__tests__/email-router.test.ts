import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    emailConnection: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
    },
    processedEmail: {
      findFirst: vi.fn(),
    },
    allowedSender: {
      count: vi.fn(),
    },
  },
}));

vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

const mockEmailQueueAdd = vi.fn();
const mockGetJob = vi.fn();
const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();

vi.mock("@/worker/queue", () => ({
  emailQueue: {
    add: mockEmailQueueAdd,
    getJob: mockGetJob,
  },
  connection: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

vi.mock("@/worker/jobs/process-user-emails", () => ({
  backfillRedisKey: (userId: string) => `backfill:active:${userId}`,
  BACKFILL_KEY_TTL: 600,
  backfillCancelKey: (userId: string) => `backfill:cancel:${userId}`,
  requestBackfillCancel: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => {
  // Track calls per identifier so the 3-call limit works
  const callCounts = new Map<string, number>();
  return {
    createRateLimiter: vi.fn().mockReturnValue({
      check: vi.fn().mockImplementation((id: string) => {
        const count = (callCounts.get(id) ?? 0) + 1;
        callCounts.set(id, count);
        return { allowed: count <= 3 };
      }),
      _resetForTest: () => callCounts.clear(),
    }),
  };
});

vi.mock("@/server/config", () => ({
  getConfig: vi.fn().mockResolvedValue({}),
  invalidateConfigCache: vi.fn(),
}));

vi.mock("@/config/excluded-sender-domains", () => ({
  isDomainExcluded: vi.fn().mockReturnValue(false),
}));

vi.mock("@/server/email-providers/token-manager", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

vi.mock("@/server/gmail/client", () => ({
  getGmailClient: vi.fn().mockReturnValue({
    users: {
      messages: {
        list: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        get: vi.fn(),
      },
    },
  }),
  parseFromHeader: vi.fn().mockReturnValue({ name: "Test", email: "test@example.com" }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { prisma } from "@/server/db/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";
import { auth } from "@/server/auth";

const mockPrisma = vi.mocked(prisma, true);
const mockAuth = vi.mocked(auth);

const USER_ID = "test-user-1";
const CONNECTION_ID = "conn-1";

async function callAs(fn: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>) {
  mockAuth.mockResolvedValue({
    user: { id: USER_ID, role: "USER", name: "Test", email: "test@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);
  const ctx = await createTRPCContext();
  const caller = appRouter.createCaller(ctx);
  return fn(caller);
}

beforeEach(async () => {
  vi.clearAllMocks();

  // Default enforceAuth middleware mock
  mockPrisma.user.findUnique.mockResolvedValue({
    householdId: null,
    household: null,
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
  } as any);

  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

// ---------------------------------------------------------------------------
// pollNow tests
// ---------------------------------------------------------------------------

describe("email.pollNow", () => {
  it("rejects when no active connection", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue(null);

    await expect(
      callAs((c) => c.email.pollNow()),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("enforces 30s cooldown", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: new Date(Date.now() - 10_000), // 10s ago
    } as any);

    await expect(
      callAs((c) => c.email.pollNow()),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("enqueues job with correct data", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: new Date(Date.now() - 60_000), // 60s ago
    } as any);

    mockEmailQueueAdd.mockResolvedValue({ id: "job-1" });

    const result = await callAs((c) => c.email.pollNow());

    expect(mockEmailQueueAdd).toHaveBeenCalledWith("process-user-emails", {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
    expect(result).toMatchObject({ jobId: "job-1" });
  });

  it("forceCount ignored when debugUI disabled", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: new Date(Date.now() - 60_000),
    } as any);
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ showDebugUI: false } as any);
    mockEmailQueueAdd.mockResolvedValue({ id: "job-2" });

    await callAs((c) => c.email.pollNow({ forceCount: 5 }));

    // forceCount should NOT be in the job data
    expect(mockEmailQueueAdd).toHaveBeenCalledWith("process-user-emails", {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
    });
  });

  it("forceCount honored when debugUI enabled", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: new Date(Date.now() - 60_000),
    } as any);
    const { getConfig } = await import("@/server/config");
    vi.mocked(getConfig).mockResolvedValueOnce({ showDebugUI: true } as any);
    mockEmailQueueAdd.mockResolvedValue({ id: "job-3" });

    await callAs((c) => c.email.pollNow({ forceCount: 5 }));

    expect(mockEmailQueueAdd).toHaveBeenCalledWith("process-user-emails", {
      userId: USER_ID,
      connectionId: CONNECTION_ID,
      forceCount: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// backfill tests
// ---------------------------------------------------------------------------

describe("email.backfill", () => {
  it("deduplicates via Redis key (returns alreadyRunning)", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: null,
    } as any);

    // Existing backfill job found in Redis
    mockRedisGet.mockResolvedValue("existing-job-id");
    mockGetJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("active"),
    });

    const result = await callAs((c) => c.email.backfill());

    expect(result).toMatchObject({ alreadyRunning: true, jobId: "existing-job-id" });
    // Should NOT have enqueued a new job
    expect(mockEmailQueueAdd).not.toHaveBeenCalled();
  });

  it("enforces 60s cooldown", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      lastPolledAt: new Date(Date.now() - 30_000), // 30s ago
    } as any);

    // No existing backfill in Redis
    mockRedisGet.mockResolvedValue(null);

    await expect(
      callAs((c) => c.email.backfill()),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});

// ---------------------------------------------------------------------------
// fetchRecentSenders tests
// ---------------------------------------------------------------------------

describe("email.fetchRecentSenders", () => {
  it("rate limited after 3 calls", async () => {
    mockPrisma.emailConnection.findUnique.mockResolvedValue({
      id: CONNECTION_ID,
      status: "ACTIVE",
      provider: "GMAIL",
    } as any);

    // First 3 calls succeed
    for (let i = 0; i < 3; i++) {
      await callAs((c) => c.email.fetchRecentSenders());
    }

    // 4th call should be rate limited
    await expect(
      callAs((c) => c.email.fetchRecentSenders()),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });
});
