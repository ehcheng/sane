import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    forwardingAddress: {
      updateMany: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock verification-token (dynamic import)
vi.mock("@/lib/verification-token", () => ({
  consumeVerificationToken: vi.fn(),
}));

// Mock pii-encryption (dynamic import)
vi.mock("@/lib/pii-encryption", () => ({
  hashEmail: vi.fn(),
}));

// Mock rate-limit
vi.mock("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({
    check: () => ({ allowed: true, retryAfterMs: 0 }),
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

// Mock error-message
vi.mock("@/lib/error-message", () => ({
  errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// Import after mocking
import { prisma } from "@/server/db/prisma";
import { consumeVerificationToken } from "@/lib/verification-token";
import { hashEmail } from "@/lib/pii-encryption";
import { GET } from "@/app/api/verify-email/route";

const mockPrisma = vi.mocked(prisma, true);
const mockConsumeToken = vi.mocked(consumeVerificationToken);
const mockHashEmail = vi.mocked(hashEmail);

function makeRequest(token?: string): NextRequest {
  const url = token
    ? `http://localhost/api/verify-email?token=${token}`
    : "http://localhost/api/verify-email";
  return new NextRequest(new URL(url));
}

/** Extract redirect URL from a 307 response */
function getRedirectUrl(response: Response): URL {
  const location = response.headers.get("Location");
  return new URL(location!);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: systemConfig returns a base URL for redirects
  mockPrisma.systemConfig.findUnique.mockResolvedValue({
    appUrl: "http://localhost:3000",
  } as any);
});

describe("GET /api/verify-email", () => {
  it("verifies fwd:<userId>:<addressId> format with ownership check", async () => {
    const userId = "user-1";
    const addressId = "addr-1";
    mockConsumeToken.mockResolvedValue({
      identifier: `fwd:${userId}:${addressId}`,
    } as any);
    mockPrisma.forwardingAddress.updateMany.mockResolvedValue({ count: 1 } as any);

    const response = await GET(makeRequest("test-token"));

    expect(mockConsumeToken).toHaveBeenCalledWith("test-token");
    expect(mockPrisma.forwardingAddress.updateMany).toHaveBeenCalledWith({
      where: { id: addressId, userId },
      data: expect.objectContaining({ isActive: true }),
    });

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("success");
    expect(redirectUrl.searchParams.get("message")).toContain("verified");
  });

  it("verifies fwd:<addressId> legacy format without userId", async () => {
    const addressId = "legacy-addr-1";
    mockConsumeToken.mockResolvedValue({
      identifier: `fwd:${addressId}`,
    } as any);
    mockPrisma.forwardingAddress.updateMany.mockResolvedValue({ count: 1 } as any);

    const response = await GET(makeRequest("legacy-token"));

    expect(mockPrisma.forwardingAddress.updateMany).toHaveBeenCalledWith({
      where: { id: addressId },
      data: expect.objectContaining({ isActive: true }),
    });

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("success");
  });

  it("returns error when fwd:<userId>:<addressId> address does not match", async () => {
    mockConsumeToken.mockResolvedValue({
      identifier: "fwd:user-1:wrong-addr",
    } as any);
    mockPrisma.forwardingAddress.updateMany.mockResolvedValue({ count: 0 } as any);

    const response = await GET(makeRequest("bad-token"));

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("error");
    expect(redirectUrl.searchParams.get("message")).toContain("not found");
  });

  it("email:<userId> sets emailVerified and auto-verifies matching forwarding addresses", async () => {
    const userId = "user-1";
    mockConsumeToken.mockResolvedValue({
      identifier: `email:${userId}`,
    } as any);
    mockPrisma.user.update.mockResolvedValue({
      email: "test@example.com",
    } as any);
    mockHashEmail.mockResolvedValue("hashed-email");
    mockPrisma.forwardingAddress.updateMany.mockResolvedValue({ count: 1 } as any);

    const response = await GET(makeRequest("email-token"));

    // Sets emailVerified on the user
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { emailVerified: expect.any(Date) },
      select: { email: true },
    });

    // Hashes the user's email for matching
    expect(mockHashEmail).toHaveBeenCalledWith("test@example.com");

    // Auto-verifies matching forwarding addresses
    expect(mockPrisma.forwardingAddress.updateMany).toHaveBeenCalledWith({
      where: { userId, emailHash: "hashed-email", verifiedAt: null },
      data: expect.objectContaining({ isActive: true }),
    });

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("success");
    expect(redirectUrl.searchParams.get("message")).toContain("email has been verified");
  });

  it("returns error redirect when token is missing", async () => {
    const response = await GET(makeRequest());

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("error");
    expect(redirectUrl.searchParams.get("message")).toContain("Missing");
    expect(mockConsumeToken).not.toHaveBeenCalled();
  });

  it("returns error redirect when token is expired (consumeVerificationToken returns null)", async () => {
    mockConsumeToken.mockResolvedValue(null);

    const response = await GET(makeRequest("expired-token"));

    const redirectUrl = getRedirectUrl(response);
    expect(redirectUrl.searchParams.get("status")).toBe("error");
    expect(redirectUrl.searchParams.get("message")).toContain("expired");
  });
});
