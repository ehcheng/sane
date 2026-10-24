import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRateLimiter, getClientIp } from "@/lib/rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter("test-under", {
      windowMs: 60_000,
      maxRequests: 5,
    });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check("user1");
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBe(0);
    }
  });

  it("blocks the (maxRequests + 1)th request", () => {
    const limiter = createRateLimiter("test-block", {
      windowMs: 60_000,
      maxRequests: 3,
    });

    limiter.check("user1");
    limiter.check("user1");
    limiter.check("user1");

    const blocked = limiter.check("user1");
    expect(blocked.allowed).toBe(false);
  });

  it("returns positive retryAfterMs when blocked", () => {
    const limiter = createRateLimiter("test-retry", {
      windowMs: 60_000,
      maxRequests: 1,
    });

    limiter.check("user1");
    const blocked = limiter.check("user1");

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("allows requests again after window passes", () => {
    const realNow = Date.now();
    let mockTime = realNow;
    vi.spyOn(Date, "now").mockImplementation(() => mockTime);

    const limiter = createRateLimiter("test-window", {
      windowMs: 10_000,
      maxRequests: 2,
    });

    limiter.check("user1");
    limiter.check("user1");
    expect(limiter.check("user1").allowed).toBe(false);

    // Advance past the window
    mockTime = realNow + 11_000;
    const result = limiter.check("user1");
    expect(result.allowed).toBe(true);

    vi.restoreAllMocks();
  });

  it("different keys are independent", () => {
    const limiter = createRateLimiter("test-keys", {
      windowMs: 60_000,
      maxRequests: 1,
    });

    limiter.check("a");
    expect(limiter.check("a").allowed).toBe(false);

    // Key "b" should still be allowed
    expect(limiter.check("b").allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  it("extracts first IP from x-forwarded-for header", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to 'unknown' when no header", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});
