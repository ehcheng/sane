import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    processedEmail: {
      findMany: vi.fn(),
    },
    extractedEvent: {
      findMany: vi.fn(),
    },
    child: {
      findMany: vi.fn(),
    },
    forwardingAddress: {
      findMany: vi.fn(),
    },
    emailConnection: {
      findUnique: vi.fn(),
    },
    briefDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/server/config", () => ({
  getConfig: vi.fn().mockResolvedValue({
    timezone: "America/Los_Angeles",
    dailyBriefEventDays: 5,
    aiBriefSummaryInstruction: "Summarize the emails.",
    dataRetentionDays: 30,
  }),
  invalidateConfigCache: vi.fn(),
}));

vi.mock("@/server/email/sender", () => ({
  sendBrief: vi.fn().mockResolvedValue({ resendMessageId: "msg-weekly-1" }),
  sendDailyBrief: vi.fn().mockResolvedValue({ resendMessageId: "msg-daily-1" }),
}));

vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock("@/lib/error-message", () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock("@/lib/ai-call-logger", () => ({
  logAICall: vi.fn(),
  stripEmailContent: vi.fn().mockReturnValue("(stripped)"),
}));

vi.mock("@/server/ai/provider", () => ({
  getAIProvider: vi.fn().mockResolvedValue({
    generateText: vi.fn().mockResolvedValue({
      text: "Summary text",
      latencyMs: 100,
      tokensInput: 50,
      tokensOutput: 30,
    }),
    providerName: "test-provider",
  }),
}));

vi.mock("@/lib/pii-encryption", () => ({
  decryptChildRecord: vi.fn().mockImplementation((r: any) =>
    Promise.resolve({ ...r, name: r.name ?? "Child" }),
  ),
  decryptForwardingRecord: vi.fn().mockImplementation((r: any) =>
    Promise.resolve({ ...r, email: r.email ?? "fwd@test.com" }),
  ),
}));

vi.mock("@/server/email-providers/token-manager", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("access-token"),
}));

vi.mock("@/server/email-providers", () => ({
  createEmailClient: vi.fn().mockReturnValue({
    getMessageContent: vi.fn().mockResolvedValue({ body: "email body" }),
  }),
}));

vi.mock("@/server/alerts/create-alert", () => ({
  createAlert: vi.fn(),
}));

vi.mock("@/lib/date-utils", () => ({
  formatTimeRange: vi.fn().mockReturnValue("9:00 AM"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { prisma } from "@/server/db/prisma";

const mockPrisma = vi.mocked(prisma, true);

beforeEach(async () => {
  vi.clearAllMocks();
  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

// ---------------------------------------------------------------------------
// Helper: build a user row matching what processSendBrief queries
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<{
  id: string;
  timezone: string;
  dailyBriefEnabled: boolean;
  weeklyBriefEnabled: boolean;
  dailyBriefHour: number;
  weeklyBriefDay: number;
  weeklyBriefHour: number;
  lastDailyBriefSentAt: Date | null;
  lastWeeklyBriefSentAt: Date | null;
  household: { primaryUserId: string } | null;
  briefScope: string;
}> = {}) {
  return {
    id: overrides.id ?? "user-1",
    timezone: overrides.timezone ?? "UTC",
    briefScope: overrides.briefScope ?? "ALL",
    dailyBriefEnabled: overrides.dailyBriefEnabled ?? false,
    weeklyBriefEnabled: overrides.weeklyBriefEnabled ?? false,
    dailyBriefHour: overrides.dailyBriefHour ?? 7,
    weeklyBriefDay: overrides.weeklyBriefDay ?? 0,
    weeklyBriefHour: overrides.weeklyBriefHour ?? 18,
    lastDailyBriefSentAt: overrides.lastDailyBriefSentAt ?? null,
    lastWeeklyBriefSentAt: overrides.lastWeeklyBriefSentAt ?? null,
    household: overrides.household ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests for processSendBrief
// ---------------------------------------------------------------------------

describe("processSendBrief", () => {
  async function importAndRun() {
    const mod = await import("@/worker/jobs/send-brief");
    return mod.processSendBrief();
  }

  it("skips deactivated users (filtered out by query)", async () => {
    // processSendBrief queries with accountStatus: { not: "DEACTIVATED" }
    mockPrisma.user.findMany.mockResolvedValue([]);

    await importAndRun();

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountStatus: { not: "DEACTIVATED" },
        }),
      }),
    );
  });

  it("daily brief: sends when hour matches dailyBriefHour", async () => {
    // We need to control getCurrentDayAndHour. Since it uses Intl.DateTimeFormat,
    // we mock it the same way poll-scheduler does.
    const OriginalDateTimeFormat = Intl.DateTimeFormat;

    // Simulate hour=7 in UTC
    (globalThis as any).Intl.DateTimeFormat = class {
      private opts: any;
      constructor(_locale?: string, opts?: any) { this.opts = opts; }
      format() {
        if (this.opts?.weekday) return "Mon";
        if (this.opts?.hour) return "7";
        // For en-CA date format used by getRestOfSchoolWeek
        return "2026-05-04"; // a Monday
      }
    } as any;

    try {
      const user = makeUser({
        dailyBriefEnabled: true,
        dailyBriefHour: 7,
        lastDailyBriefSentAt: null,
      });
      mockPrisma.user.findMany.mockResolvedValue([user] as any);

      // BriefDelivery.create for pending record
      mockPrisma.briefDelivery.create.mockResolvedValue({ id: "bd-1" } as any);

      // sendUserBrief will query these:
      mockPrisma.processedEmail.findMany.mockResolvedValue([
        {
          id: "pe-1",
          externalMessageId: "ext-1",
          fromAddress: "school@test.com",
          fromName: "School",
          subject: "Newsletter",
          aiSubject: "School Newsletter",
          aiSummary: "Weekly update",
          aiDecision: true,
          receivedAt: new Date(),
          attachmentCount: 0,
          forwarded: true,
          topicSlug: null,
        },
      ] as any);

      mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
      mockPrisma.child.findMany.mockResolvedValue([]);
      mockPrisma.forwardingAddress.findMany.mockResolvedValue([
        { id: "fa-1", email: "fwd@test.com", isActive: true, verifiedAt: new Date() },
      ] as any);

      mockPrisma.user.update.mockResolvedValue({} as any);
      mockPrisma.briefDelivery.update.mockResolvedValue({} as any);

      await importAndRun();

      // Verify sendDailyBrief was called via sender mock
      const { sendDailyBrief } = await import("@/server/email/sender");
      expect(sendDailyBrief).toHaveBeenCalled();

      // Verify delivery record was resolved
      expect(mockPrisma.briefDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bd-1" },
          data: expect.objectContaining({ status: "sent" }),
        }),
      );
    } finally {
      (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
  });

  it("daily brief: skips when lastDailyBriefSentAt < 23 hours ago", async () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;

    (globalThis as any).Intl.DateTimeFormat = class {
      private opts: any;
      constructor(_locale?: string, opts?: any) { this.opts = opts; }
      format() {
        if (this.opts?.weekday) return "Tue";
        if (this.opts?.hour) return "7";
        return "2026-05-05";
      }
    } as any;

    try {
      const recentSend = new Date(Date.now() - 20 * 60 * 60 * 1000); // 20 hours ago (< 23h)
      const user = makeUser({
        dailyBriefEnabled: true,
        dailyBriefHour: 7,
        lastDailyBriefSentAt: recentSend,
      });
      mockPrisma.user.findMany.mockResolvedValue([user] as any);

      await importAndRun();

      // sendDailyBrief should NOT have been called
      const { sendDailyBrief } = await import("@/server/email/sender");
      expect(sendDailyBrief).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
  });

  it("weekly brief: sends when day+hour match", async () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;

    // Sunday hour=18
    (globalThis as any).Intl.DateTimeFormat = class {
      private opts: any;
      constructor(_locale?: string, opts?: any) { this.opts = opts; }
      format() {
        if (this.opts?.weekday === "short") return "Sun";
        if (this.opts?.hour) return "18";
        // en-CA format
        return "2026-05-03";
      }
    } as any;

    try {
      const user = makeUser({
        weeklyBriefEnabled: true,
        weeklyBriefDay: 0, // Sunday
        weeklyBriefHour: 18,
        lastWeeklyBriefSentAt: null,
      });
      mockPrisma.user.findMany.mockResolvedValue([user] as any);
      mockPrisma.briefDelivery.create.mockResolvedValue({ id: "bd-w1" } as any);

      mockPrisma.processedEmail.findMany.mockResolvedValue([
        {
          id: "pe-w1",
          externalMessageId: "ext-w1",
          fromAddress: "school@test.com",
          fromName: "School",
          subject: "Weekly",
          aiSubject: null,
          aiSummary: "Summary",
          aiDecision: true,
          receivedAt: new Date(),
          attachmentCount: 0,
          forwarded: false,
          topicSlug: null,
        },
      ] as any);

      mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
      mockPrisma.emailConnection.findUnique.mockResolvedValue({
        id: "conn-1",
        status: "ACTIVE",
        provider: "GMAIL",
      } as any);
      mockPrisma.child.findMany.mockResolvedValue([]);
      mockPrisma.forwardingAddress.findMany.mockResolvedValue([
        { id: "fa-w1", email: "fwd@test.com", isActive: true, verifiedAt: new Date() },
      ] as any);

      mockPrisma.user.update.mockResolvedValue({} as any);
      mockPrisma.briefDelivery.update.mockResolvedValue({} as any);

      await importAndRun();

      const { sendBrief } = await import("@/server/email/sender");
      expect(sendBrief).toHaveBeenCalled();
    } finally {
      (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
  });

  it("skips when no relevant emails AND no upcoming events", async () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;

    (globalThis as any).Intl.DateTimeFormat = class {
      private opts: any;
      constructor(_locale?: string, opts?: any) { this.opts = opts; }
      format() {
        if (this.opts?.weekday) return "Mon";
        if (this.opts?.hour) return "7";
        return "2026-05-04";
      }
    } as any;

    try {
      const user = makeUser({
        dailyBriefEnabled: true,
        dailyBriefHour: 7,
      });
      mockPrisma.user.findMany.mockResolvedValue([user] as any);
      mockPrisma.briefDelivery.create.mockResolvedValue({ id: "bd-skip" } as any);

      // No emails
      mockPrisma.processedEmail.findMany.mockResolvedValue([]);
      // No events
      mockPrisma.extractedEvent.findMany.mockResolvedValue([]);

      await importAndRun();

      // Should have resolved delivery as "skipped"
      expect(mockPrisma.briefDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "skipped" }),
        }),
      );

      // No brief email sent
      const { sendDailyBrief } = await import("@/server/email/sender");
      expect(sendDailyBrief).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
  });

  it("records delivery in BriefDelivery table", async () => {
    const OriginalDateTimeFormat = Intl.DateTimeFormat;

    (globalThis as any).Intl.DateTimeFormat = class {
      private opts: any;
      constructor(_locale?: string, opts?: any) { this.opts = opts; }
      format() {
        if (this.opts?.weekday) return "Mon";
        if (this.opts?.hour) return "7";
        return "2026-05-04";
      }
    } as any;

    try {
      const user = makeUser({
        dailyBriefEnabled: true,
        dailyBriefHour: 7,
      });
      mockPrisma.user.findMany.mockResolvedValue([user] as any);
      mockPrisma.briefDelivery.create.mockResolvedValue({ id: "bd-rec" } as any);

      mockPrisma.processedEmail.findMany.mockResolvedValue([
        {
          id: "pe-r1",
          externalMessageId: "ext-r1",
          fromAddress: "school@test.com",
          fromName: null,
          subject: "Test",
          aiSubject: null,
          aiSummary: null,
          aiDecision: true,
          receivedAt: new Date(),
          attachmentCount: 0,
          forwarded: false,
          topicSlug: null,
        },
      ] as any);
      mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
      mockPrisma.child.findMany.mockResolvedValue([]);
      mockPrisma.forwardingAddress.findMany.mockResolvedValue([
        { id: "fa-r1", email: "fwd@test.com", isActive: true, verifiedAt: new Date() },
      ] as any);
      mockPrisma.user.update.mockResolvedValue({} as any);
      mockPrisma.briefDelivery.update.mockResolvedValue({} as any);

      await importAndRun();

      // Verify pending delivery was created
      expect(mockPrisma.briefDelivery.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          briefType: "daily",
          status: "pending",
        },
      });

      // Verify delivery was resolved as sent
      expect(mockPrisma.briefDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "bd-rec" },
          data: expect.objectContaining({
            status: "sent",
            resendMessageId: "msg-daily-1",
          }),
        }),
      );
    } finally {
      (globalThis as any).Intl.DateTimeFormat = OriginalDateTimeFormat;
    }
  });
});
