import { describe, it, expect, vi, beforeEach } from "vitest";
import { signToken, verifyToken } from "@/lib/hmac-token";

beforeEach(() => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret-for-hmac-unit-tests");
});

describe("signToken / verifyToken", () => {
  it("round-trip: sign then verify returns original payload", () => {
    const payload = { userId: "abc123", action: "unsubscribe" };
    const token = signToken(payload);
    const result = verifyToken<typeof payload>(token);

    expect(result).not.toBeNull();
    expect(result!.userId).toBe("abc123");
    expect(result!.action).toBe("unsubscribe");
    expect(result!.exp).toBeGreaterThan(Date.now());
  });

  it("expired token returns null", () => {
    // Sign with a tiny expiry, then advance time past it
    const payload = { id: "x" };
    const token = signToken(payload, 0.0001); // ~8.6 seconds

    // Mock Date.now to be well past expiry
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);

    expect(verifyToken(token)).toBeNull();

    vi.restoreAllMocks();
  });

  it("tampered payload returns null", () => {
    const token = signToken({ userId: "abc" });
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);

    // Tamper with the payload string
    parsed.payload = parsed.payload.replace("abc", "xyz");

    const tampered = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    expect(verifyToken(tampered)).toBeNull();
  });

  it("tampered signature returns null", () => {
    const token = signToken({ userId: "abc" });
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);

    // Flip one character in the hex signature
    const sig = parsed.signature;
    parsed.signature = sig[0] === "a" ? "b" + sig.slice(1) : "a" + sig.slice(1);

    const tampered = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    expect(verifyToken(tampered)).toBeNull();
  });

  it("completely malformed input returns null", () => {
    expect(verifyToken("not-a-valid-token")).toBeNull();
    expect(verifyToken("")).toBeNull();
    expect(verifyToken("aGVsbG8")).toBeNull(); // base64url of "hello"
  });

  it("custom expiryDays: very short expiry expires quickly", () => {
    const payload = { test: true };
    // 0.001 days = ~86 seconds
    const token = signToken(payload, 0.001);

    // Advance time past the expiry
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 100_000);

    expect(verifyToken(token)).toBeNull();

    vi.restoreAllMocks();
  });
});
