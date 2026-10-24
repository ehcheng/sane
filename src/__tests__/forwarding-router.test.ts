import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Prisma before importing anything that uses it
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    forwardingAddress: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock auth
vi.mock("@/server/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

// Mock pii-encryption (used via dynamic import)
vi.mock("@/lib/pii-encryption", () => ({
  encryptForwardingFields: vi.fn().mockResolvedValue({
    emailEncrypted: Buffer.from("enc-email"),
    nameEncrypted: Buffer.from("enc-name"),
    emailHash: "hash-123",
  }),
  hashEmail: vi.fn().mockResolvedValue("hash-123"),
  decryptForwardingRecord: vi.fn().mockImplementation((record) =>
    Promise.resolve({
      ...record,
      email: "test@example.com",
      name: "Test User",
    })
  ),
}));

// Mock verification-token
vi.mock("@/lib/verification-token", () => ({
  createVerificationToken: vi.fn().mockResolvedValue("mock-token"),
}));

// Mock email sender
vi.mock("@/server/email/sender", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendMonitoringStoppedEmail: vi.fn().mockResolvedValue(undefined),
}));

// Mock encryption
vi.mock("@/lib/encryption", () => ({
  encrypt: vi.fn().mockReturnValue(Buffer.from("encrypted-data")),
  decrypt: vi.fn().mockReturnValue("decrypted-value"),
}));

// Mock rate-limit: use a real-ish limiter that tracks call count
const resendCallCounts = new Map<string, number>();
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: (name: string, opts: { maxRequests: number }) => ({
    check: (key: string) => {
      const mapKey = `${name}:${key}`;
      const count = (resendCallCounts.get(mapKey) ?? 0) + 1;
      resendCallCounts.set(mapKey, count);
      return {
        allowed: count <= opts.maxRequests,
        retryAfterMs: count > opts.maxRequests ? 60000 : 0,
      };
    },
  }),
  getClientIp: () => "127.0.0.1",
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import { prisma } from "@/server/db/prisma";
import { auth } from "@/server/auth";
import { appRouter } from "@/server/trpc/router";
import { createTRPCContext } from "@/server/trpc/trpc";

const mockPrisma = vi.mocked(prisma, true);
const mockAuth = vi.mocked(auth);

const TEST_USER_ID = "00000000-0000-0000-0000-000000000001";
const ADDR_ID = "00000000-0000-0000-0000-0000000000a1";

function setupAuth(userId = TEST_USER_ID) {
  mockAuth.mockResolvedValue({
    user: { id: userId, role: "USER", name: "Test", email: "test@example.com" },
    expires: new Date(Date.now() + 86400000).toISOString(),
  } as any);
}

async function createCaller(userId = TEST_USER_ID) {
  setupAuth(userId);
  const ctx = await createTRPCContext();
  return appRouter.createCaller(ctx);
}

beforeEach(async () => {
  vi.clearAllMocks();
  resendCallCounts.clear();

  // Default middleware mock: user exists, active, no household
  mockPrisma.user.findUnique.mockResolvedValue({
    householdId: null,
    household: null,
    accountStatus: "ACTIVE",
    lastActiveAt: new Date(),
    role: "USER",
  } as any);

  // Invalidate config cache between tests
  const { invalidateConfigCache } = await import("@/server/config");
  invalidateConfigCache();
});

describe("forwarding.create", () => {
  it("upserts with emailHash and returns decrypted record", async () => {
    const mockAddress = {
      id: ADDR_ID,
      userId: TEST_USER_ID,
      emailEncrypted: Buffer.from("enc"),
      emailHash: "hash-123",
      verifiedAt: new Date(),
      isActive: true,
      label: "Home",
      createdAt: new Date(),
    };
    mockPrisma.forwardingAddress.upsert.mockResolvedValue(mockAddress as any);

    const caller = await createCaller();
    const result = await caller.forwarding.create({
      email: "test@example.com",
      name: "Test User",
      label: "Home",
    });

    // Verify upsert was called with emailHash for dedup
    expect(mockPrisma.forwardingAddress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_emailHash: {
            userId: TEST_USER_ID,
            emailHash: "hash-123",
          },
        },
      })
    );

    // Returns decrypted record
    expect(result).toHaveProperty("email", "test@example.com");
  });

  it("auto-verifies when forwarding email matches verified login email", async () => {
    // Upsert returns unverified address
    const mockAddress = {
      id: ADDR_ID,
      userId: TEST_USER_ID,
      emailEncrypted: Buffer.from("enc"),
      emailHash: "hash-123",
      verifiedAt: null,
      isActive: false,
      createdAt: new Date(),
    };
    mockPrisma.forwardingAddress.upsert.mockResolvedValue(mockAddress as any);

    // User has matching verified login email
    mockPrisma.user.findUniqueOrThrow.mockResolvedValue({
      email: "test@example.com",
      emailVerified: new Date(),
    } as any);

    // Update after auto-verify
    mockPrisma.forwardingAddress.update.mockResolvedValue({
      ...mockAddress,
      verifiedAt: new Date(),
      isActive: true,
    } as any);

    const caller = await createCaller();
    const result = await caller.forwarding.create({
      email: "test@example.com",
      name: "Test",
    });

    // Should have auto-verified
    expect(mockPrisma.forwardingAddress.update).toHaveBeenCalledWith({
      where: { id: ADDR_ID },
      data: expect.objectContaining({ isActive: true }),
    });
    expect(result).toHaveProperty("email", "test@example.com");
  });
});

describe("forwarding.update", () => {
  it("computes new emailHash and resets verification on email change", async () => {
    const existing = {
      id: ADDR_ID,
      userId: TEST_USER_ID,
      emailEncrypted: Buffer.from("old-enc"),
      emailHash: "old-hash",
      nameEncrypted: Buffer.from("old-name"),
      verifiedAt: new Date(),
      isActive: true,
    };
    mockPrisma.forwardingAddress.findUnique.mockResolvedValue(existing as any);

    // decryptForwardingRecord returns old email
    const { decryptForwardingRecord } = await import("@/lib/pii-encryption");
    vi.mocked(decryptForwardingRecord)
      .mockResolvedValueOnce({ ...existing, email: "old@example.com", name: "Old" } as any)
      // Second call: after the update, returns new decrypted record
      .mockResolvedValueOnce({ ...existing, email: "new@example.com", name: "Old", verifiedAt: null } as any);

    mockPrisma.forwardingAddress.update.mockResolvedValue({
      ...existing,
      emailHash: "new-hash",
      verifiedAt: null,
    } as any);

    const caller = await createCaller();
    const result = await caller.forwarding.update({
      id: ADDR_ID,
      email: "new@example.com",
    });

    // Verification should be reset
    expect(mockPrisma.forwardingAddress.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ADDR_ID, userId: TEST_USER_ID },
        data: expect.objectContaining({
          verifiedAt: null,
        }),
      })
    );
  });
});

describe("forwarding.delete", () => {
  it("pauses monitoring when deleting last address", async () => {
    // Transaction returns [deleteResult, count]. Count of 0 means no addresses remain.
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([{}, 0]);
    mockPrisma.user.update.mockResolvedValue({} as any);

    const caller = await createCaller();
    const result = await caller.forwarding.delete({ id: ADDR_ID });

    expect(result.success).toBe(true);
    expect(result.monitoringPaused).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER_ID },
      data: { isMonitoringEnabled: false },
    });
  });

  it("keeps monitoring enabled when deleting non-last address", async () => {
    // Count of 2 means 2 addresses still remain after deletion
    (mockPrisma.$transaction as ReturnType<typeof vi.fn>).mockResolvedValue([{}, 2]);

    const caller = await createCaller();
    const result = await caller.forwarding.delete({ id: ADDR_ID });

    expect(result.success).toBe(true);
    expect(result.monitoringPaused).toBe(false);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("forwarding.resendVerification", () => {
  it("is rate limited after 3 calls", async () => {
    const mockAddress = {
      id: ADDR_ID,
      userId: TEST_USER_ID,
      emailEncrypted: Buffer.from("enc"),
      verifiedAt: null,
    };
    mockPrisma.forwardingAddress.findUnique.mockResolvedValue(mockAddress as any);

    // First 3 calls should succeed
    for (let i = 0; i < 3; i++) {
      const caller = await createCaller();
      const result = await caller.forwarding.resendVerification({ id: ADDR_ID });
      expect(result.sent).toBe(true);
    }

    // 4th call should be rate limited
    const caller = await createCaller();
    await expect(
      caller.forwarding.resendVerification({ id: ADDR_ID })
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});
