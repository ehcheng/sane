/**
 * In-memory sliding-window rate limiter.
 * No dependencies — resets on restart, suitable for single-instance alpha.
 */

interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterMs: number };
}

const store = new Map<string, number[]>();
const MAX_STORE_ENTRIES = 100_000;

// Periodic cleanup every 60s to prevent memory leaks
const CLEANUP_INTERVAL_MS = 60_000;
const cleanupTimer = setInterval(() => {
  const now = Date.now();

  // Emergency eviction: drop oldest half if store is oversized
  if (store.size > MAX_STORE_ENTRIES) {
    const entries = Array.from(store.entries());
    // Sort by most recent timestamp descending, keep the freshest half
    entries.sort((a, b) => {
      const aMax = a[1].length > 0 ? a[1][a[1].length - 1] : 0;
      const bMax = b[1].length > 0 ? b[1][b[1].length - 1] : 0;
      return bMax - aMax;
    });
    store.clear();
    const keep = Math.floor(entries.length / 2);
    for (let i = 0; i < keep; i++) {
      store.set(entries[i][0], entries[i][1]);
    }
    return;
  }

  store.forEach((timestamps, key) => {
    const filtered = timestamps.filter((t: number) => now - t < 900_000); // 15min max window
    if (filtered.length === 0) {
      store.delete(key);
    } else {
      store.set(key, filtered);
    }
  });
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref();

export function createRateLimiter(
  name: string,
  { windowMs, maxRequests }: RateLimiterOptions
): RateLimiter {
  return {
    check(key: string): { allowed: boolean; retryAfterMs: number } {
      const storeKey = `${name}:${key}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      const existing = store.get(storeKey) ?? [];
      const inWindow = existing.filter((t) => t > windowStart);

      if (inWindow.length >= maxRequests) {
        const oldestInWindow = inWindow[0]!;
        const retryAfterMs = oldestInWindow + windowMs - now;
        return { allowed: false, retryAfterMs };
      }

      inWindow.push(now);
      store.set(storeKey, inWindow);
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

/** Extract client IP from request, reading x-forwarded-for (set by Railway/proxies). */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    // x-forwarded-for can be comma-separated; first entry is the client
    return forwarded.split(",")[0]!.trim();
  }
  return "unknown";
}
