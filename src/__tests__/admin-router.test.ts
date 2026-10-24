import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// Mock Prisma before importing anything that uses it
// vi.mock is hoisted so we can't reference external variables in the factory
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    processedEmail: {
      groupBy: vi.fn(),
    },
    processedEmailDailyStats: {
      groupBy: vi.fn(),
    },
    systemConfig: {
      findUniqueOrThrow: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    $queryRaw: vi.fn(),
    emailConnection: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock auth module so trpc.ts can import it
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

// Mock encryption
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn().mockReturnValue(Buffer.from("encrypted-data")),
  decrypt: vi.fn().mockReturnValue("decrypted-key"),
}));

// Mock AI provider cache invalidation
vi.mock("@/server/ai/provider-cache", () => ({
  invalidateProviderCache: vi.fn(),
}));

// Import after mocking
import { prisma } from "@/server/db/prisma";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

// Use vi.mocked to get typed mock access
const mockPrisma = vi.mocked(prisma, true);

// The real createTRPCContext calls auth(), so we mock auth to return
// the session we want, then call the router via createCallerFactory.
import { auth } from "@/server/auth";
import { encrypt } from "@/lib/encryption";
import { invalidateProviderCache } from "@/server/ai/provider-cache";
const mockAuth = vi.mocked(auth);
const mockEncrypt = vi.mocked(encrypt);
const mockInvalidateCache = vi.mocked(invalidateProviderCache);

function createCaller(role: "USER" | "ADMIN", userId = "test-user-1") {
  mockAuth.mockResolvedValue({
    user: { id: userId, role, name: "Test", email: "test@test.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);

  // createCallerFactory needs a context factory
  const callerFactory = appRouter.createCaller;
  // We return an async caller that creates context first
  return {
    admin: {
      users: async () => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.users();
      },
      tokenUsage: async (input: { days: number }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.tokenUsage(input);
      },
      setUserMonitoring: async (input: {
        userId: string;
        enabled: boolean;
      }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.setUserMonitoring(input);
      },
      globalConfig: async () => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.globalConfig();
      },
      setGlobalMonitoring: async (input: { enabled: boolean }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.setGlobalMonitoring(input);
      },
      aiConfig: async () => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.aiConfig();
      },
      setAIConfig: async (input: {
        provider: "openai" | "anthropic" | "grok";
        model: string;
        apiKey: string;
      }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.setAIConfig(input);
      },
      clearAIConfig: async () => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.clearAIConfig();
      },
      setRecentActivityLimit: async (input: { limit: number }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.setRecentActivityLimit(input);
      },
      deleteUser: async (input: { userId: string }) => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.admin.deleteUser(input);
      },
    },
    user: {
      globalMonitoringStatus: async () => {
        const ctx = await createTRPCContext();
        const caller = appRouter.createCaller(ctx);
        return caller.user.globalMonitoringStatus();
      },
    },
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  // enforceAuth middleware checks user existence, household, and accountStatus via findUnique.
  // enforceAdmin also calls findUnique to re-verify the role from DB.
  // Return all fields needed by both middlewares.
  mockPrisma.user.findUnique.mockResolvedValue({
    householdId: null,
    household: null,
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
    role: "ADMIN",
  } as any);
  // Invalidate the config cache so each test gets fresh values from the prisma mock
  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

describe("admin.users", () => {
  it("returns users with enriched counts", async () => {
    const mockUsers = [
      {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Test User",
        email: "test@test.com",
        isMonitoringEnabled: true,
        createdAt: new Date(),
        emailConnection: {
          status: "ACTIVE",
          emailAddress: "test@gmail.com",
          lastPolledAt: new Date(),
          provider: "GMAIL",
        },
        _count: { children: 2, processedEmails: 10 },
      },
    ];

    mockPrisma.user.findMany.mockResolvedValue(mockUsers as any);
    mockPrisma.processedEmail.groupBy
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _count: 5 }] as any)   // forwarded
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _count: 3 }] as any)   // skipped
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _sum: { attachmentCount: 2 } }] as any) // attachments
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _count: 4 }] as any)   // delivered
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _count: 1 }] as any)   // bounced
      .mockResolvedValueOnce([{ userId: "00000000-0000-0000-0000-000000000001", _max: { createdAt: new Date() } }] as any); // lastProcessedDates
    (mockPrisma as any).processedEmailDailyStats.groupBy
      .mockResolvedValueOnce([] as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.users();

    expect(result).toHaveLength(1);
    expect(result[0].forwardedCount).toBe(5);
    expect(result[0].skippedCount).toBe(3);
    expect(result[0].name).toBe("Test User");
  });
});

describe("admin.setUserMonitoring", () => {
  it("calls prisma.user.update with correct args", async () => {
    mockPrisma.user.update.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      isMonitoringEnabled: false,
    } as any);

    const caller = createCaller("ADMIN");
    await caller.admin.setUserMonitoring({
      userId: "00000000-0000-0000-0000-000000000001",
      enabled: false,
    });

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      data: { isMonitoringEnabled: false },
      select: { id: true, isMonitoringEnabled: true },
    });
  });
});

describe("admin.globalConfig", () => {
  it("returns singleton config including recentActivityLimit", async () => {
    mockPrisma.systemConfig.findUniqueOrThrow.mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: true,
      recentActivityLimit: 50,
      updatedAt: new Date("2026-01-01"),
    } as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.globalConfig();

    expect(result.isMonitoringEnabled).toBe(true);
    expect(result.recentActivityLimit).toBe(50);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });
});

describe("admin.setGlobalMonitoring", () => {
  it("calls prisma.systemConfig.update", async () => {
    mockPrisma.systemConfig.update.mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: false,
      updatedAt: new Date(),
    } as any);

    const caller = createCaller("ADMIN");
    await caller.admin.setGlobalMonitoring({ enabled: false });

    expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { isMonitoringEnabled: false },
      select: { isMonitoringEnabled: true, updatedAt: true },
    });
  });
});

describe("admin.tokenUsage", () => {
  it("transforms bigints to numbers", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        day: new Date("2026-02-01"),
        tokens_input: BigInt(1500),
        tokens_output: BigInt(500),
        email_count: BigInt(10),
      },
    ]);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.tokenUsage({ days: 30 });

    expect(result).toHaveLength(1);
    expect(result[0].day).toBe("2026-02-01");
    expect(result[0].tokensInput).toBe(1500);
    expect(result[0].tokensOutput).toBe(500);
    expect(result[0].emailCount).toBe(10);
  });
});

describe("admin procedures access control", () => {
  it("throws FORBIDDEN when called with USER role", async () => {
    // Override default mock: enforceAdmin now verifies role from DB
    mockPrisma.user.findUnique.mockResolvedValue({
      householdId: null, household: null, accountStatus: "ACTIVE", lastActiveAt: new Date(), role: "USER",
    } as any);
    const caller = createCaller("USER");
    await expect(caller.admin.users()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("user.globalMonitoringStatus", () => {
  it("returns global monitoring status for regular users", async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: false,
      updatedAt: new Date(),
    } as any);

    const caller = createCaller("USER", "00000000-0000-0000-0000-000000000001");
    const result = await caller.user.globalMonitoringStatus();

    expect(result.isGlobalMonitoringEnabled).toBe(false);
  });

  it("defaults to true when no config exists", async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const caller = createCaller("USER", "00000000-0000-0000-0000-000000000001");
    const result = await caller.user.globalMonitoringStatus();

    expect(result.isGlobalMonitoringEnabled).toBe(true);
  });
});

describe("admin.aiConfig", () => {
  it("returns hasApiKey: false when no key configured", async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      aiProvider: null,
      aiModel: null,
      aiApiKeyEncrypted: null,
      updatedAt: new Date(),
    } as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.aiConfig();

    expect(result.provider).toBeNull();
    expect(result.model).toBeNull();
    expect(result.hasApiKey).toBe(false);
  });

  it("returns hasApiKey: true when key is set", async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      aiProvider: "openai",
      aiModel: "gpt-4.1",
      aiApiKeyEncrypted: Buffer.from("encrypted"),
      updatedAt: new Date("2026-02-08"),
    } as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.aiConfig();

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4.1");
    expect(result.hasApiKey).toBe(true);
  });
});

describe("admin.setAIConfig", () => {
  it("encrypts key, updates config, and invalidates cache", async () => {
    mockPrisma.systemConfig.update.mockResolvedValue({} as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.setAIConfig({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      apiKey: "sk-ant-test-key",
    });

    expect(result.success).toBe(true);
    expect(mockEncrypt).toHaveBeenCalledWith("sk-ant-test-key");
    expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: {
        aiProvider: "anthropic",
        aiModel: "claude-sonnet-4-5-20250929",
        aiVisionModel: null,
        aiApiKeyEncrypted: Buffer.from("encrypted-data"),
        tokenCostInputPerMillion: 3,
        tokenCostOutputPerMillion: 15,
      },
    });
    expect(mockInvalidateCache).toHaveBeenCalled();
  });

  it("updates provider and model without key when key already exists", async () => {
    // Return existing encrypted key from DB
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      aiApiKeyEncrypted: Buffer.from("existing-encrypted"),
    } as any);
    mockPrisma.systemConfig.update.mockResolvedValue({} as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.setAIConfig({
      provider: "openai",
      model: "gpt-4.1-mini",
    });

    expect(result.success).toBe(true);
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: {
        aiProvider: "openai",
        aiModel: "gpt-4.1-mini",
        aiVisionModel: null,
        tokenCostInputPerMillion: 2,
        tokenCostOutputPerMillion: 8,
      },
    });
  });

  it("throws when no key provided and no key exists in DB", async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({
      aiApiKeyEncrypted: null,
    } as any);

    const caller = createCaller("ADMIN");
    await expect(
      caller.admin.setAIConfig({
        provider: "openai",
        model: "gpt-4.1",
      })
    ).rejects.toThrow("API key is required");
  });
});

describe("admin.clearAIConfig", () => {
  it("nulls all AI fields and invalidates cache", async () => {
    mockPrisma.systemConfig.update.mockResolvedValue({} as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.clearAIConfig();

    expect(result.success).toBe(true);
    expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: {
        aiProvider: null,
        aiModel: null,
        aiVisionModel: null,
        aiApiKeyEncrypted: null,
      },
    });
    expect(mockInvalidateCache).toHaveBeenCalled();
  });
});

describe("admin.setRecentActivityLimit", () => {
  it("updates the limit in SystemConfig", async () => {
    mockPrisma.systemConfig.update.mockResolvedValue({} as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.setRecentActivityLimit({ limit: 100 });

    expect(result.success).toBe(true);
    expect(mockPrisma.systemConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { recentActivityLimit: 100 },
    });
  });
});

describe("admin.deleteUser", () => {
  const userId = "00000000-0000-0000-0000-000000000001";

  it("deletes a USER-role account", async () => {
    // First call: enforceAdmin middleware (session user), second call: deleteUser (target user)
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN" } as any)
      .mockResolvedValueOnce({ id: userId, role: "USER" } as any);
    mockPrisma.emailConnection.findUnique.mockResolvedValue(null);
    mockPrisma.user.delete.mockResolvedValue({} as any);

    const caller = createCaller("ADMIN");
    const result = await caller.admin.deleteUser({ userId });

    expect(result.success).toBe(true);
    expect(mockPrisma.user.delete).toHaveBeenCalledWith({
      where: { id: userId },
    });
  });

  it("throws when target user is ADMIN", async () => {
    // First call: enforceAdmin middleware, second call: deleteUser lookup
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN" } as any)
      .mockResolvedValueOnce({ id: userId, role: "ADMIN" } as any);

    const caller = createCaller("ADMIN");
    await expect(caller.admin.deleteUser({ userId })).rejects.toThrow(
      "Cannot delete admin accounts."
    );
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it("throws when user not found", async () => {
    // First call: enforceAdmin middleware (succeeds), second call: deleteUser (null)
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ role: "ADMIN" } as any)
      .mockResolvedValueOnce(null);

    const caller = createCaller("ADMIN");
    await expect(caller.admin.deleteUser({ userId })).rejects.toThrow(
      "User not found."
    );
    expect(mockPrisma.user.delete).not.toHaveBeenCalled();
  });

  it("rejects non-admin callers", async () => {
    // Override default mock: enforceAdmin now verifies role from DB
    mockPrisma.user.findUnique.mockResolvedValue({
      householdId: null, household: null, accountStatus: "ACTIVE", lastActiveAt: new Date(), role: "USER",
    } as any);
    const caller = createCaller("USER");
    await expect(caller.admin.deleteUser({ userId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
