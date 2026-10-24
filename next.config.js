const isDev = process.env.NODE_ENV !== "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  // Suppress X-Powered-By header to prevent technology fingerprinting (CWE-200).
  poweredByHeader: false,

  env: {
    NEXT_PUBLIC_APP_VERSION: (() => {
      const { version } = require("./package.json");
      const [major, minor] = version.split(".");
      // Try git commit count (local dev), then build-number file (Docker/CI),
      // then APP_BUILD_NUMBER env var, then fall back to raw package.json
      let build;
      try {
        const { execSync } = require("child_process");
        build = execSync("git rev-list --count HEAD", {
          encoding: "utf-8",
        }).trim();
      } catch {}
      if (!build) {
        try {
          build = require("fs")
            .readFileSync("build-number", "utf-8")
            .trim();
        } catch {}
      }
      if (!build) build = process.env.APP_BUILD_NUMBER;
      return build ? `${major}.${minor}.${build}` : version;
    })(),
  },

  // Image optimization security: restrict /_next/image to a strict allowlist.
  //
  // Next.js validates the `w` query parameter against these arrays. Any width
  // not listed here returns 400. This prevents abuse of the image endpoint
  // as a server-side request proxy or oracle (CWE-918, CWE-89 false positive
  // from ESOF scan where scanner injected arithmetic into `w`).
  //
  // remotePatterns: [] blocks ALL external URLs. Only images in public/ are served.
  // If a remote source is ever needed, add an explicit origin here.
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    remotePatterns: [],
  },

  experimental: {
    serverComponentsExternalPackages: ["bcryptjs"],
    instrumentationHook: true,
  },

  async headers() {
    // ──────────────────────────────────────────────────────────────────────
    // Security response headers applied to every route.
    //
    // These are defense-in-depth. The primary controls (auth, input validation,
    // parameterized queries via Prisma) are in the application layer. These
    // headers harden the browser's behavior as a second line of defense.
    // ──────────────────────────────────────────────────────────────────────
    const securityHeaders = [
      {
        // Content-Security-Policy: restrict what the browser is allowed to load.
        //
        // 'unsafe-inline' in script-src and style-src: required by Next.js.
        //   - script-src: Next.js injects inline <script> tags for page data
        //     (__NEXT_DATA__) and hydration. Nonce-based CSP is not yet
        //     supported in Next.js 14 pages router. When migrating fully to
        //     app router, revisit with nonce support.
        //   - style-src: Tailwind and component libraries inject inline styles.
        //
        // 'unsafe-eval' in dev only: required for React Fast Refresh HMR.
        //   Stripped in production builds.
        key: "Content-Security-Policy",
        value: [
          "default-src 'self'",
          `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self'",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "form-action 'self'",
          "base-uri 'self'",
          "object-src 'none'",
        ].join("; "),
      },

      // Clickjacking protection. Redundant with frame-ancestors 'none' in CSP,
      // but kept for browsers that don't support CSP2 (CWE-1021).
      { key: "X-Frame-Options", value: "DENY" },

      // Prevent MIME-type sniffing. Stops browsers from reinterpreting
      // response content types, which can enable XSS via content-type
      // confusion (CWE-16).
      { key: "X-Content-Type-Options", value: "nosniff" },

      // Limit Referer leakage. 'strict-origin-when-cross-origin' sends full
      // URL for same-origin requests, origin-only for cross-origin HTTPS,
      // and nothing for HTTPS->HTTP downgrades.
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

      // Disable browser features we don't use. interest-cohort=() opts out
      // of Google's FLoC tracking.
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
      },

      // HSTS: force HTTPS for 2 years, include subdomains, allow preload list
      // submission. Once in the preload list, browsers will never make an
      // insecure request to this domain.
      {
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      },

      // Cross-origin isolation headers. Mitigate Spectre-class side-channel
      // attacks by preventing cross-origin resources from being loaded into
      // this origin's process (CWE-693).
      //
      // CORP: same-origin prevents any other origin from embedding our resources.
      // COOP: same-origin isolates our browsing context (prevents cross-origin
      //       window.opener references that could leak data via side channels).
      //
      // Note: COEP (require-corp) is intentionally omitted. It would break
      // loading any resource that doesn't set its own CORP header, and we
      // don't need SharedArrayBuffer or high-resolution timers.
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    // ────────────────────────────────────────────────────────────────────
    // Cache-control strategy (CWE-524, CWE-525).
    //
    // All HTML pages and API responses are marked uncacheable. This
    // prevents Railway's edge CDN (or any intermediate proxy) from storing
    // and replaying responses that may contain session cookies.
    //
    // Without this, Next.js SSG pages get `s-maxage=31536000` in
    // production, which Railway's CDN caches. The ESOF scanner flagged
    // this on /, /login, /privacy, /signup (findings #7, #8).
    //
    // Performance impact: minimal. Static JS/CSS/images under /_next/static
    // and /_next/image bypass these headers (served directly by Next.js
    // with immutable hashed-filename caching). Only HTML page shells
    // become uncacheable.
    //
    // Directives:
    //   private    - shared caches (CDN, proxy) MUST NOT store
    //   no-cache   - caches must revalidate before reuse
    //   no-store   - caches MUST NOT store any part of the response
    //   must-revalidate - stale responses MUST NOT be served
    //   Pragma/Expires  - HTTP 1.0 backward compatibility
    // ────────────────────────────────────────────────────────────────────
    const noCacheHeaders = [
      { key: "Cache-Control", value: "private, no-cache, no-store, must-revalidate" },
      { key: "Pragma", value: "no-cache" },
      { key: "Expires", value: "0" },
    ];

    return [
      {
        // Security headers on all routes (including _next/static, which is fine).
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Cache-control on all HTML pages. Excludes _next/static (hashed
        // immutable assets) and _next/image (optimized images with their own
        // cache TTL) so they retain browser-cacheable performance.
        source: "/((?!_next/static|_next/image).*)",
        headers: noCacheHeaders,
      },
    ];
  },
};

// Wrap with Sentry (no-op when SENTRY_DSN is not set)
const { withSentryConfig } = require("@sentry/nextjs");

module.exports = withSentryConfig(nextConfig, {
  // Suppress source map upload noise in local dev
  silent: true,

  // Don't upload source maps unless SENTRY_AUTH_TOKEN is set (production builds)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Widen the scope of server-side instrumentation
  widenClientFileUpload: true,

  // Automatically tree-shake Sentry logger in production
  disableLogger: true,
});
