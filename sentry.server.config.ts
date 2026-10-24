import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  enabled: process.env.NODE_ENV === "production",

  // Sample 100% of errors, 10% of performance transactions
  tracesSampleRate: 0.1,
});
