import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

// Mock Prisma
vi.mock("@/server/db/prisma", () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(),
    },
    processedEmail: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
    },
    briefDelivery: {
      updateMany: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
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
import { POST } from "@/app/api/webhooks/resend/route";

const mockPrisma = vi.mocked(prisma, true);

// Svix signature helper
const WEBHOOK_SECRET = "whsec_" + Buffer.from("test-secret-key-1234").toString("base64");

function signPayload(body: string, svixId: string, timestamp: string): string {
  const secretBytes = Buffer.from(
    WEBHOOK_SECRET.slice(6),
    "base64"
  );
  const signedContent = `${svixId}.${timestamp}.${body}`;
  const sig = crypto
    .createHmac("sha256", secretBytes)
    .update(signedContent)
    .digest("base64");
  return `v1,${sig}`;
}

function makeSignedRequest(
  event: { type: string; data: Record<string, unknown> }
): NextRequest {
  const body = JSON.stringify(event);
  const svixId = "msg_test_123";
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const svixSignature = signPayload(body, svixId, svixTimestamp);

  return new NextRequest(new URL("http://localhost/api/webhooks/resend"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    },
    body,
  });
}

function makeUnsignedRequest(
  event: { type: string; data: Record<string, unknown> },
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest(new URL("http://localhost/api/webhooks/resend"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(event),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: webhook is enabled with a secret
  mockPrisma.systemConfig.findUnique.mockResolvedValue({
    resendWebhookSecret: WEBHOOK_SECRET,
    resendWebhookEnabled: true,
  } as any);
});

describe("POST /api/webhooks/resend", () => {
  it("updates processedEmail and briefDelivery in parallel on delivery event", async () => {
    mockPrisma.processedEmail.updateMany.mockResolvedValue({ count: 1 } as any);
    mockPrisma.briefDelivery.updateMany.mockResolvedValue({ count: 0 } as any);
    // For fire-and-forget activity tracking
    mockPrisma.processedEmail.findFirst.mockResolvedValue({
      userId: "user-1",
    } as any);
    mockPrisma.user.update.mockResolvedValue({} as any);

    const response = await POST(
      makeSignedRequest({
        type: "email.delivered",
        data: { email_id: "resend-msg-1" },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);

    // Both update calls made in parallel
    expect(mockPrisma.processedEmail.updateMany).toHaveBeenCalledWith({
      where: { resendMessageId: "resend-msg-1" },
      data: expect.objectContaining({
        deliveryStatus: "delivered",
        deliveryUpdatedAt: expect.any(Date),
      }),
    });
    expect(mockPrisma.briefDelivery.updateMany).toHaveBeenCalledWith({
      where: { resendMessageId: "resend-msg-1" },
      data: expect.objectContaining({
        deliveryStatus: "delivered",
        deliveryUpdatedAt: expect.any(Date),
      }),
    });
  });

  it("logs warning on bounce event", async () => {
    mockPrisma.processedEmail.updateMany.mockResolvedValue({ count: 1 } as any);
    mockPrisma.briefDelivery.updateMany.mockResolvedValue({ count: 0 } as any);

    const response = await POST(
      makeSignedRequest({
        type: "email.bounced",
        data: {
          email_id: "resend-msg-2",
          bounce: { message: "Mailbox full" },
        },
      })
    );

    expect(response.status).toBe(200);

    // Captures bounce reason in deliveryError
    expect(mockPrisma.processedEmail.updateMany).toHaveBeenCalledWith({
      where: { resendMessageId: "resend-msg-2" },
      data: expect.objectContaining({
        deliveryStatus: "bounced",
        deliveryError: "Mailbox full",
      }),
    });

    // Logger.warn called for bounce
    const logger = (await import("@/lib/logger")).default;
    expect(logger.warn).toHaveBeenCalledWith(
      "resend-webhook",
      expect.stringContaining("bounced"),
      expect.objectContaining({
        emailId: "resend-msg-2",
        deliveryStatus: "bounced",
      })
    );
  });

  it("returns 401 when svix headers are missing", async () => {
    const response = await POST(
      makeUnsignedRequest(
        { type: "email.delivered", data: { email_id: "msg-1" } }
        // No svix headers
      )
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toContain("Missing signature");
  });

  it("acknowledges unrecognized event type without processing", async () => {
    const response = await POST(
      makeSignedRequest({
        type: "email.created",
        data: { email_id: "msg-unknown" },
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.received).toBe(true);

    // No DB updates for unrecognized events
    expect(mockPrisma.processedEmail.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.briefDelivery.updateMany).not.toHaveBeenCalled();
  });

  it("fires lastActiveAt update on delivery event (fire-and-forget)", async () => {
    mockPrisma.processedEmail.updateMany.mockResolvedValue({ count: 1 } as any);
    mockPrisma.briefDelivery.updateMany.mockResolvedValue({ count: 0 } as any);
    mockPrisma.processedEmail.findFirst.mockResolvedValue({
      userId: "user-1",
    } as any);
    mockPrisma.user.update.mockResolvedValue({} as any);

    await POST(
      makeSignedRequest({
        type: "email.delivered",
        data: { email_id: "resend-msg-3" },
      })
    );

    // Wait a tick for the fire-and-forget promise chain to resolve
    await new Promise((r) => setTimeout(r, 50));

    // Looks up the userId from processedEmail
    expect(mockPrisma.processedEmail.findFirst).toHaveBeenCalledWith({
      where: { resendMessageId: "resend-msg-3" },
      select: { userId: true },
    });

    // Updates user's lastActiveAt
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { lastActiveAt: expect.any(Date) },
    });
  });
});
