import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all external dependencies. vi.mock is hoisted, so use string literals only.
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(),
    },
    emailConnection: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// The queue module is imported by poll-scheduler as "../queue" relative to
// src/worker/jobs/. We mock it via the alias that vitest resolves.
vi.mock("@/worker/queue", () => ({
  emailQueue: {
    add: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/server/config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    timezone: "America/Los_Angeles",
    activeHoursStart: 6,
    activeHoursEnd: 22,
    pollIntervalMinutes: 5,
  }),
}));

vi.mock("@/server/gmail/quota-tracker", () => ({
  isUserPaused: vi.fn().mockReturnValue(false),
}));

// Import after mocking
const { prisma } = await import("@/server/db/prisma");
const mockPrisma = vi.mocked(prisma, true);

// Mock active hours at module level — we override isWithinActiveHours behavior
// by mocking Intl.DateTimeFormat to return a time within active hours.

describe("processPollScheduler", () => {
  const OriginalDateTimeFormat = Intl.DateTimeFormat;

  beforeEach(() => {
    vi.clearAllMocks();
    // Simulate being within active hours (noon) by replacing DateTimeFormat
    // with a class that returns "12" from format()
    (globalThis as any).Intl.DateTimeFormat = class MockDateTimeFormat {
      format() {
        return "12";
      }
    } as any;
  });

  afterEach(() => {
    (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
  });

  async function importAndRun() {
    const mod = await import("@/worker/jobs/poll-scheduler");
    return mod.processPollScheduler();
  }

  it("returns early when global monitoring is disabled", async () => {
    (mockPrisma.systemConfig.findUnique as any).mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: false,
      updatedAt: new Date(),
    });

    await importAndRun();

    expect(mockPrisma.systemConfig.findUnique).toHaveBeenCalledWith({
      where: { id: "singleton" },
    });
    // Should NOT have queried for gmail connections
    expect(mockPrisma.emailConnection.findMany).not.toHaveBeenCalled();
  });

  it("proceeds when global monitoring is enabled", async () => {
    (mockPrisma.systemConfig.findUnique as any).mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: true,
      updatedAt: new Date(),
    });
    (mockPrisma.emailConnection.findMany as any).mockResolvedValue([]);
    (mockPrisma.emailConnection.count as any).mockResolvedValue(0);

    await importAndRun();

    expect(mockPrisma.emailConnection.findMany).toHaveBeenCalled();
  });

  it("still respects per-user isMonitoringEnabled filtering", async () => {
    (mockPrisma.systemConfig.findUnique as any).mockResolvedValue({
      id: "singleton",
      isMonitoringEnabled: true,
      updatedAt: new Date(),
    });
    (mockPrisma.emailConnection.findMany as any).mockResolvedValue([]);
    (mockPrisma.emailConnection.count as any).mockResolvedValue(0);

    await importAndRun();

    expect(mockPrisma.emailConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          user: {
            isMonitoringEnabled: true,
            emailVerified: { not: null },
            accountStatus: { not: "DEACTIVATED" },
          },
        }),
      })
    );
  });
});
