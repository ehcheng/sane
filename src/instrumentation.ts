// ---------------------------------------------------------------------------
// Next.js instrumentation hook: runs once on server startup.
//
// Fires warm-up requests to pre-compile key API routes so the first real
// user request doesn't pay a 20-30s cold-start penalty.
// ---------------------------------------------------------------------------

export async function register() {
  // Initialize Sentry for server-side error tracking
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }

  // Only run the rest in the Node.js runtime (not edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Validate required env vars at startup (fail fast)
  const { validateEnv } = await import("@/lib/env-check");
  validateEnv("web");

  // Small delay to let the HTTP server bind before we hit it
  setTimeout(async () => {
    const port = process.env.PORT || "3000";
    const base = `http://localhost:${port}`;

    const routes = [
      "/api/health",
      // tRPC batch call that exercises the admin router (will 401, but still compiles the route)
      "/api/trpc/admin.systemStatus,admin.globalConfig?batch=1&input=%7B%7D",
    ];

    for (const route of routes) {
      try {
        await fetch(`${base}${route}`, {
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        // Expected: 401 on admin routes, connection refused if server isn't ready yet.
        // Either way the route is now compiled.
      }
    }

    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "INFO",
        tag: "warmup",
        msg: `Warmed ${routes.length} route(s)`,
      })
    );
  }, 2000);
}
