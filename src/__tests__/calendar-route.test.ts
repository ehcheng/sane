import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    extractedEvent: {
      findMany: vi.fn(),
    },
  },
}));

// Mock ICS generation
vi.mock("@/lib/ics", () => ({
  generateICSFeed: vi.fn().mockReturnValue("BEGIN:VCALENDAR\nEND:VCALENDAR"),
}));

// Mock rate-limit
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({
    check: () => ({ allowed: true, retryAfterMs: 0 }),
  }),
  getClientIp: () => "127.0.0.1",
}));

// Mock pii-encryption (dynamic import in route)
vi.mock("@/lib/pii-encryption", () => ({
  decryptChildRecord: vi.fn().mockImplementation((c) =>
    Promise.resolve({ ...c, name: "Child Name" })
  ),
}));

// Import after mocking
import { prisma } from "@/server/db/prisma";
import { generateICSFeed } from "@/lib/ics";
import { GET } from "@/app/api/calendar/[token]/route";

const mockPrisma = vi.mocked(prisma, true);
const mockGenerateICS = vi.mocked(generateICSFeed);

function makeRequest(token: string): [NextRequest, { params: { token: string } }] {
  const request = new NextRequest(
    new URL(`http://localhost/api/calendar/${token}`)
  );
  return [request, { params: { token } }];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/calendar/[token]", () => {
  it("returns ICS content with correct Content-Type for valid token", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      timezone: "America/New_York",
      actionableEventsOnly: false,
      accountStatus: "ACTIVE",
      lastActiveAt: new Date(),
      lastCalendarAccessAt: new Date(),
      household: null,
    } as any);
    mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
    mockGenerateICS.mockReturnValue("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR");

    const response = await GET(...makeRequest("valid-token-1234567890"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8"
    );
    const body = await response.text();
    expect(body).toContain("VCALENDAR");
  });

  it("returns 404 for invalid/missing token", async () => {
    // Token too short (< 10 chars)
    const response = await GET(...makeRequest("short"));

    expect(response.status).toBe(404);
  });

  it("returns 404 when token matches no user", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const response = await GET(...makeRequest("nonexistent-token-12345"));

    expect(response.status).toBe(404);
  });

  it("returns empty ICS for deactivated user (not 404)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      timezone: "America/Chicago",
      actionableEventsOnly: false,
      accountStatus: "DEACTIVATED",
      lastActiveAt: new Date(),
      household: null,
    } as any);
    mockGenerateICS.mockReturnValue("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR");

    const response = await GET(...makeRequest("deactivated-token-12345"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/calendar; charset=utf-8"
    );
    // generateICSFeed called with empty array
    expect(mockGenerateICS).toHaveBeenCalledWith([], {
      timezone: "America/Chicago",
    });
    // Should NOT query for events
    expect(mockPrisma.extractedEvent.findMany).not.toHaveBeenCalled();
  });

  it("updates lastActiveAt if stale (>1 hour)", async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      timezone: "America/New_York",
      actionableEventsOnly: false,
      accountStatus: "ACTIVE",
      lastActiveAt: staleDate,
      lastCalendarAccessAt: staleDate,
      household: null,
    } as any);
    mockPrisma.extractedEvent.findMany.mockResolvedValue([]);
    // The update is fire-and-forget, so mock it to resolve
    mockPrisma.user.update.mockResolvedValue({} as any);

    await GET(...makeRequest("stale-user-token-12345"));

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastActiveAt: expect.any(Date) },
    });
  });

  it("skips lastActiveAt update if recent (<1 hour)", async () => {
    const recentDate = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      timezone: "America/New_York",
      actionableEventsOnly: false,
      accountStatus: "ACTIVE",
      lastActiveAt: recentDate,
      lastCalendarAccessAt: recentDate,
      household: null,
    } as any);
    mockPrisma.extractedEvent.findMany.mockResolvedValue([]);

    await GET(...makeRequest("recent-user-token-1234"));

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
