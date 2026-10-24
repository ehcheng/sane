import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing anything that uses it
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    emailConnection: {
      updateMany: vi.fn(),
    },
    processedEmail: {
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/server/config", () => ({
  getConfig: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@/server/email/sender", () => ({
  sendInactivityWarning: vi.fn(),
  sendDeactivationNotice: vi.fn(),
  sendReactivationNotice: vi.fn(),
  sendHouseholdDeactivationNotice: vi.fn(),
}));

// Mock countSchoolDays for precise control over inactivity thresholds
vi.mock("@/lib/school-year", () => ({
  countSchoolDays: vi.fn(),
}));

// Import after mocking
import { prisma } from "@/server/db/prisma";
import { getConfig } from "@/server/config";
import { countSchoolDays } from "@/lib/school-year";
import {
  sendInactivityWarning,
  sendDeactivationNotice,
  sendReactivationNotice,
  sendHouseholdDeactivationNotice,
} from "@/server/email/sender";
import logger from "@/lib/logger";
import { processUserLifecycle } from "@/worker/jobs/user-lifecycle";

const mockPrisma = vi.mocked(prisma, true);
const mockGetConfig = vi.mocked(getConfig);
const mockCountSchoolDays = vi.mocked(countSchoolDays);
const mockSendWarning = vi.mocked(sendInactivityWarning);
const mockSendDeactivation = vi.mocked(sendDeactivationNotice);
const mockSendReactivation = vi.mocked(sendReactivationNotice);
const mockLogger = vi.mocked(logger, true);

// Helper: create a mock user with sensible defaults
function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    accountStatus: "ACTIVE",
    lastActiveAt: new Date("2026-01-01"),
    lastCalendarAccessAt: null,
    inactivityNotifiedAt: null,
    lifecycleEmailsSent: 0,
    createdAt: new Date("2025-06-01"),
    ...overrides,
  };
}

function configWith(enforcing: boolean) {
  mockGetConfig.mockResolvedValue({
    lifecycleEnforcementEnabled: enforcing,
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.update.mockResolvedValue({} as any);
  mockPrisma.emailConnection.updateMany.mockResolvedValue({ count: 1 } as any);
  mockSendWarning.mockResolvedValue(undefined);
  mockSendDeactivation.mockResolvedValue(undefined);
  mockSendReactivation.mockResolvedValue(undefined);
  // Default: no processed emails (tests can override)
  (prisma.processedEmail.groupBy as any).mockResolvedValue([]);
});

describe("processUserLifecycle", () => {
  // -------------------------------------------------------------------
  // 1. ACTIVE user with 30+ school days inactive, enforcement ON
  // -------------------------------------------------------------------
  it("transitions ACTIVE user to WARNING and sends warning email when 30+ inactive school days and enforcement ON", async () => {
    configWith(true);
    mockPrisma.user.findMany.mockResolvedValue([makeUser()] as any);
    mockCountSchoolDays.mockReturnValue(30);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: expect.objectContaining({
          accountStatus: "WARNING",
          lifecycleEmailsSent: 1,
        }),
      })
    );
    expect(mockPrisma.user.update.mock.calls[0][0].data.inactivityNotifiedAt).toBeInstanceOf(Date);
    expect(mockSendWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "user@example.com",
        daysRemaining: 14,
      })
    );
  });

  // -------------------------------------------------------------------
  // 2. ACTIVE user with 30+ inactive days, enforcement OFF
  // -------------------------------------------------------------------
  it("does not transition ACTIVE user when enforcement is OFF, just logs", async () => {
    configWith(false);
    mockPrisma.user.findMany.mockResolvedValue([makeUser()] as any);
    mockCountSchoolDays.mockReturnValue(35);

    await processUserLifecycle();

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockSendWarning).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith(
      "user-lifecycle",
      expect.stringContaining("enforcement disabled")
    );
  });

  // -------------------------------------------------------------------
  // 3. ACTIVE user with 29 days inactive (below threshold)
  // -------------------------------------------------------------------
  it("does not transition ACTIVE user with only 29 inactive school days", async () => {
    configWith(true);
    mockPrisma.user.findMany.mockResolvedValue([makeUser()] as any);
    mockCountSchoolDays.mockReturnValue(29);

    await processUserLifecycle();

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockSendWarning).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // 4. WARNING user who became active after warning -> reactivated
  // -------------------------------------------------------------------
  it("reactivates WARNING user who became active after the warning was issued", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");
    const activeAfterWarning = new Date("2026-04-05");

    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: warnedAt,
        lastActiveAt: activeAfterWarning,
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    expect(mockSendReactivation).toHaveBeenCalledWith({ to: "user@example.com" });
    expect(mockSendWarning).not.toHaveBeenCalled();
    expect(mockSendDeactivation).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // 4b. WARNING user reactivated by processed email activity
  // -------------------------------------------------------------------
  it("reactivates WARNING user when lastProcessedEmailAt is after inactivityNotifiedAt", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");

    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: warnedAt,
        lastActiveAt: new Date("2026-03-01"), // before warning
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    // Processed email after warning was issued
    (prisma.processedEmail.groupBy as any).mockResolvedValue([
      { userId: "user-1", _max: { createdAt: new Date("2026-04-05") } },
    ]);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    expect(mockSendReactivation).toHaveBeenCalledWith({ to: "user@example.com" });
  });

  // -------------------------------------------------------------------
  // 4c. WARNING user reactivated by ICS calendar access
  // -------------------------------------------------------------------
  it("reactivates WARNING user when lastCalendarAccessAt is after inactivityNotifiedAt", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");

    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: warnedAt,
        lastActiveAt: new Date("2026-03-01"),
        lastCalendarAccessAt: new Date("2026-04-03"), // after warning
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    expect(mockSendReactivation).toHaveBeenCalledWith({ to: "user@example.com" });
  });

  // -------------------------------------------------------------------
  // 4d. WARNING user NOT reactivated when all activity is BEFORE warning
  // -------------------------------------------------------------------
  it("does not reactivate WARNING user when all activity predates the warning", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T00:00:00.000Z")); // 2 days after warning

    try {
      mockPrisma.user.findMany.mockResolvedValue([
        makeUser({
          accountStatus: "WARNING",
          inactivityNotifiedAt: warnedAt,
          lastActiveAt: new Date("2026-03-20"), // before warning
          lastCalendarAccessAt: new Date("2026-03-25"), // before warning
          lifecycleEmailsSent: 1,
        }),
      ] as any);

      // Processed email also before warning
      (prisma.processedEmail.groupBy as any).mockResolvedValue([
        { userId: "user-1", _max: { createdAt: new Date("2026-03-28") } },
      ]);

      await processUserLifecycle();

      // Should NOT be reactivated; no state change to ACTIVE
      const updateCalls = mockPrisma.user.update.mock.calls;
      const reactivationCall = updateCalls.find(
        (c) => c[0].data.accountStatus === "ACTIVE"
      );
      expect(reactivationCall).toBeUndefined();
      expect(mockSendReactivation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------
  // 4e. Household member reactivated by primary's processed email
  // -------------------------------------------------------------------
  it("reactivates household member when primary has recent email activity", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");

    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        id: "member-1",
        email: "member@example.com",
        accountStatus: "WARNING",
        inactivityNotifiedAt: warnedAt,
        lastActiveAt: new Date("2026-03-01"),
        householdId: "hh-1",
        household: { primaryUserId: "primary-1", members: [] },
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    // Primary's email activity (after warning)
    (prisma.processedEmail.groupBy as any).mockResolvedValue([
      { userId: "primary-1", _max: { createdAt: new Date("2026-04-05") } },
    ]);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "member-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    expect(mockSendReactivation).toHaveBeenCalledWith({ to: "member@example.com" });
  });

  // -------------------------------------------------------------------
  // 4f. Reactivation email failure does not block reactivation
  // -------------------------------------------------------------------
  it("reactivates user even if reactivation email fails", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01");

    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: warnedAt,
        lastActiveAt: new Date("2026-04-05"),
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    mockSendReactivation.mockRejectedValueOnce(new Error("Resend down"));

    await processUserLifecycle();

    // DB update still happened
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    // Error was logged
    expect(mockLogger.error).toHaveBeenCalledWith(
      "user-lifecycle",
      expect.stringContaining("Failed to send reactivation notice")
    );
  });

  // -------------------------------------------------------------------
  // 5. WARNING user, enforcement turned OFF -> reset to ACTIVE
  // -------------------------------------------------------------------
  it("resets WARNING user to ACTIVE when enforcement is turned OFF", async () => {
    configWith(false);
    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: new Date("2026-04-01"),
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    expect(mockLogger.info).toHaveBeenCalledWith(
      "user-lifecycle",
      expect.stringContaining("enforcement disabled")
    );
  });

  // -------------------------------------------------------------------
  // 6. WARNING user, 7 days since warning -> 7-day reminder
  // -------------------------------------------------------------------
  it("sends 7-day reminder to WARNING user after 7 days since warning", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-04-08T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      mockPrisma.user.findMany.mockResolvedValue([
        makeUser({
          accountStatus: "WARNING",
          inactivityNotifiedAt: warnedAt,
          lastActiveAt: new Date("2026-03-01"), // before warning
          lifecycleEmailsSent: 1,
        }),
      ] as any);

      await processUserLifecycle();

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { lifecycleEmailsSent: 2 },
      });
      expect(mockSendWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          daysRemaining: 7,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------
  // 7. WARNING user, 13 days since warning -> 1-day reminder
  // -------------------------------------------------------------------
  it("sends 1-day reminder to WARNING user after 13 days since warning", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-04-14T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      mockPrisma.user.findMany.mockResolvedValue([
        makeUser({
          accountStatus: "WARNING",
          inactivityNotifiedAt: warnedAt,
          lastActiveAt: new Date("2026-03-01"),
          lifecycleEmailsSent: 2,
        }),
      ] as any);

      await processUserLifecycle();

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: "user-1" },
        data: { lifecycleEmailsSent: 3 },
      });
      expect(mockSendWarning).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "user@example.com",
          daysRemaining: 1,
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------
  // 8. WARNING user, 14+ days since warning -> DEACTIVATED
  // -------------------------------------------------------------------
  it("deactivates WARNING user after 14+ days since warning, disconnects email, sends notice", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-04-15T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      mockPrisma.user.findMany.mockResolvedValue([
        makeUser({
          accountStatus: "WARNING",
          inactivityNotifiedAt: warnedAt,
          lastActiveAt: new Date("2026-03-01"),
          lifecycleEmailsSent: 3,
        }),
      ] as any);

      await processUserLifecycle();

      // User should be deactivated
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: expect.objectContaining({
            accountStatus: "DEACTIVATED",
            isMonitoringEnabled: false,
            lifecycleEmailsSent: 4,
          }),
        })
      );
      expect(mockPrisma.user.update.mock.calls[0][0].data.deactivatedAt).toBeInstanceOf(Date);

      // Email connection should be disconnected
      expect(mockPrisma.emailConnection.updateMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        data: { status: "DISCONNECTED" },
      });

      // Deactivation notice sent, but NOT household notice (no household)
      expect(mockSendDeactivation).toHaveBeenCalledWith({ to: "user@example.com" });
      expect(mockSendWarning).not.toHaveBeenCalled();
      expect(vi.mocked(sendHouseholdDeactivationNotice)).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------
  // 9. Email send failure does not abort processing of other users
  // -------------------------------------------------------------------
  it("continues processing other users when an email send fails", async () => {
    configWith(true);
    mockCountSchoolDays.mockReturnValue(30);

    const user1 = makeUser({ id: "user-fail", email: "fail@example.com" });
    const user2 = makeUser({ id: "user-ok", email: "ok@example.com" });

    mockPrisma.user.findMany.mockResolvedValue([user1, user2] as any);

    // First user's warning email fails
    mockSendWarning
      .mockRejectedValueOnce(new Error("Resend API error"))
      .mockResolvedValueOnce(undefined);

    await processUserLifecycle();

    // Both users should still get their DB update
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-fail" } })
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-ok" } })
    );

    // Error was logged but didn't stop processing
    expect(mockLogger.error).toHaveBeenCalledWith(
      "user-lifecycle",
      expect.stringContaining("Failed to send warning email")
    );
  });

  // -------------------------------------------------------------------
  // 10. Admin users are excluded from processing
  // -------------------------------------------------------------------
  it("excludes admin users from lifecycle processing via the query filter", async () => {
    configWith(true);
    mockPrisma.user.findMany.mockResolvedValue([] as any);

    await processUserLifecycle();

    // The findMany query should filter to role: "USER" only
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "USER",
        }),
      })
    );
  });

  // -------------------------------------------------------------------
  // 11. ACTIVE user with null lastActiveAt uses createdAt as fallback
  // -------------------------------------------------------------------
  it("uses createdAt as activity baseline when lastActiveAt is null", async () => {
    configWith(true);
    const createdAt = new Date("2025-06-01");
    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        lastActiveAt: null,
        lastCalendarAccessAt: null,
        createdAt,
      }),
    ] as any);
    mockCountSchoolDays.mockReturnValue(30);

    await processUserLifecycle();

    // Verify createdAt was used as the "from" date
    expect(mockCountSchoolDays).toHaveBeenCalledWith(createdAt, expect.any(Date));
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accountStatus: "WARNING" }),
      })
    );
  });

  // -------------------------------------------------------------------
  // 12. ACTIVE user kept active by ICS alone (lastActiveAt stale)
  // -------------------------------------------------------------------
  it("does not warn ACTIVE user when lastCalendarAccessAt is recent", async () => {
    configWith(true);
    // lastActiveAt is very old, but ICS was accessed recently
    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        lastActiveAt: new Date("2025-12-01"),
        lastCalendarAccessAt: new Date("2026-05-01"), // recent
      }),
    ] as any);
    // countSchoolDays should be called with the ICS date (most recent signal)
    // which would yield a small number of days
    mockCountSchoolDays.mockReturnValue(5);

    await processUserLifecycle();

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockSendWarning).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // 13. ACTIVE user kept active by processed email alone
  // -------------------------------------------------------------------
  it("does not warn ACTIVE user when processedEmail activity is recent", async () => {
    configWith(true);
    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        lastActiveAt: new Date("2025-12-01"), // stale
        lastCalendarAccessAt: null,
      }),
    ] as any);
    // Processed email is recent
    (prisma.processedEmail.groupBy as any).mockResolvedValue([
      { userId: "user-1", _max: { createdAt: new Date("2026-05-01") } },
    ]);
    mockCountSchoolDays.mockReturnValue(3);

    await processUserLifecycle();

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockSendWarning).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------
  // 14. Deactivation notifies household partners when primary is deactivated
  // -------------------------------------------------------------------
  it("notifies household partners when the primary user is deactivated", async () => {
    configWith(true);
    const warnedAt = new Date("2026-04-01T00:00:00.000Z");
    const now = new Date("2026-04-15T00:00:00.000Z");

    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      vi.mocked(sendHouseholdDeactivationNotice).mockResolvedValue(undefined);

      mockPrisma.user.findMany.mockResolvedValue([
        makeUser({
          id: "primary-1",
          name: "Primary User",
          email: "primary@example.com",
          accountStatus: "WARNING",
          inactivityNotifiedAt: warnedAt,
          lastActiveAt: new Date("2026-03-01"),
          lifecycleEmailsSent: 3,
          householdId: "hh-1",
          household: {
            primaryUserId: "primary-1",
            members: [
              { id: "primary-1", email: "primary@example.com" },
              { id: "partner-1", email: "partner@example.com" },
            ],
          },
        }),
      ] as any);

      await processUserLifecycle();

      // Primary is deactivated
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "primary-1" },
          data: expect.objectContaining({ accountStatus: "DEACTIVATED" }),
        })
      );

      // Partner is notified
      expect(vi.mocked(sendHouseholdDeactivationNotice)).toHaveBeenCalledWith({
        to: "partner@example.com",
        ownerName: "Primary User",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  // -------------------------------------------------------------------
  // 15. WARNING user enforcement OFF does NOT send reactivation email
  // -------------------------------------------------------------------
  it("does not send reactivation email when resetting due to enforcement OFF", async () => {
    configWith(false);
    mockPrisma.user.findMany.mockResolvedValue([
      makeUser({
        accountStatus: "WARNING",
        inactivityNotifiedAt: new Date("2026-04-01"),
        lifecycleEmailsSent: 1,
      }),
    ] as any);

    await processUserLifecycle();

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        accountStatus: "ACTIVE",
        inactivityNotifiedAt: null,
        lifecycleEmailsSent: 0,
      },
    });
    // No reactivation email for enforcement-off resets
    expect(mockSendReactivation).not.toHaveBeenCalled();
  });
});
