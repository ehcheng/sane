import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only enable in production (skip local dev)
  enabled: process.env.NODE_ENV === "production",

  // Sample 100% of errors, 10% of performance transactions
  tracesSampleRate: 0.1,

  // Reduce noise: filter out common non-actionable errors
  ignoreErrors: [
    "ResizeObserver loop",
    "ChunkLoadError",
    "Loading chunk",
    "Network request failed",
  ],
});
