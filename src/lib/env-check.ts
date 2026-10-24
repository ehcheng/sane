/**
 * Validate that all required environment variables are present at startup.
 * Call this early in both the Next.js instrumentation hook and the worker entry point.
 * Fails fast with a clear listing of what is missing.
 */

const REQUIRED_VARS = [
  "DATABASE_URL",
  "REDIS_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
] as const;

// Additional vars only needed by the worker process
const WORKER_REQUIRED_VARS: readonly string[] = [] as const;

export function validateEnv(context: "web" | "worker" = "web"): void {
  const vars = context === "worker"
    ? [...REQUIRED_VARS, ...WORKER_REQUIRED_VARS]
    : [...REQUIRED_VARS];

  const missing = vars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    const msg = `Missing required environment variable(s): ${missing.join(", ")}`;
    console.error(`[env-check] FATAL: ${msg}`);
    throw new Error(msg);
  }
}
