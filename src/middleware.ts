import { auth } from "@/server/auth";
import { NextResponse } from "next/server";

// ──────────────────────────────────────────────────────────────────────────
// Public paths: routes accessible without authentication.
//
// SECURITY: every path listed here is reachable by unauthenticated users.
// Do NOT add routes that expose PII, user data, or admin functionality.
// When adding a new public route, verify it does not accept sensitive
// query parameters or leak internal state.
// ──────────────────────────────────────────────────────────────────────────
const publicPaths = [
  // Marketing / unauthenticated pages
  "/",
  "/login",
  "/signup",
  "/setup-admin",
  "/about",
  "/faq",
  "/privacy",
  "/terms",
  "/contactsane",
  "/verify-result",
  "/forgot-password",
  "/reset-password",
  "/unsubscribe",

  // SEO and PWA metadata: must be publicly accessible.
  // These are Next.js metadata routes that serve machine-readable data only
  // (no PII, no user content). CWE-345 remediation.
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",

  // Auth infrastructure (NextAuth handlers)
  "/api/auth",

  // Public API endpoints (each handles its own auth/token validation internally)
  "/api/health",
  "/api/verify-email",
  "/api/webhooks",
  "/api/feedback",
  "/api/calendar",
  "/api/sender-rule",
  "/api/contact",
  "/api/forgot-password",
  "/api/reset-password",
  "/api/validate-reset-token",
  "/api/unsubscribe",
];

export default auth((req) => {
  const { pathname, host } = req.nextUrl;

  // ── HTTP method restriction ─────────────────────────────────────────
  // TRACE and TRACK methods are rejected by Next.js edge runtime before
  // this middleware executes (TypeError: unsupported HTTP method).
  // This prevents cross-site tracing (XST) attacks at the framework level.
  // In production, Railway's edge proxy provides an additional layer.
  // No application-layer check is needed or possible here.
  // ────────────────────────────────────────────────────────────────────

  // Force HTTPS in production. Railway terminates TLS at its edge and
  // forwards the original protocol via x-forwarded-proto. A 301 permanent
  // redirect ensures browsers cache the upgrade (complements HSTS).
  if (
    req.headers.get("x-forwarded-proto") === "http" &&
    !host.startsWith("localhost")
  ) {
    const httpsUrl = new URL(req.url);
    httpsUrl.protocol = "https:";
    return NextResponse.redirect(httpsUrl, 301);
  }

  // Allow public paths (exact match or prefix + slash to prevent partial matches,
  // e.g. "/login" matches "/login" and "/login/callback" but not "/login-admin")
  if (publicPaths.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // These API routes validate auth via HMAC-signed tokens in the URL,
  // not via session cookies. They handle their own authorization.
  if (pathname.startsWith("/api/gmail/") || pathname.startsWith("/api/events/") || pathname.startsWith("/api/household/")) {
    return NextResponse.next();
  }

  // ── Authentication gate ─────────────────────────────────────────────
  // Everything below this point requires a valid session.
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const role = req.auth.user?.role;

  // ── Authorization: role-based access control ────────────────────────
  // Block non-admins from /admin routes (horizontal privilege escalation, CWE-862)
  if (pathname.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/events", req.url));
  }

  // Redirect admins away from user routes to /admin (separation of concerns,
  // admins use a dedicated interface)
  if (
    role === "ADMIN" &&
    !pathname.startsWith("/admin") &&
    !pathname.startsWith("/api")
  ) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  return NextResponse.next();
});

// ──────────────────────────────────────────────────────────────────────────
// Middleware matcher: defines which requests pass through this middleware.
//
// Excluded paths (bypass middleware entirely for performance):
//   - _next/static: immutable build assets (hashed filenames, no auth needed)
//   - _next/image: image optimization endpoint (validated by Next.js internally,
//     restricted via images config in next.config.js)
//   - Static file extensions: .png, .jpg, .jpeg, .svg, .gif, .ico, .webp
//   - favicon.ico: browser auto-request
//   - api/health: uptime monitoring (must respond without auth overhead)
//
// SECURITY: if you add a new static extension here, ensure the file type
// cannot contain executable content that bypasses CSP.
// ──────────────────────────────────────────────────────────────────────────
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.svg$|.*\\.gif$|.*\\.ico$|.*\\.webp$|api/health).*)",
  ],
};
