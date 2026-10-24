import type { MetadataRoute } from "next";

// Robots.txt via Next.js Metadata API.
// Serves with Content-Type: text/plain (CWE-345 remediation).
//
// SECURITY: disallow paths expose route names to crawlers. This is acceptable
// because the routes are already discoverable in client-side JS bundles.
// The disallow directives prevent indexing of authenticated content, not
// discovery of route existence.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Public marketing pages only
        allow: ["/", "/about", "/faq", "/privacy", "/terms"],
        // Authenticated routes and internal paths: no crawling.
        // Auth middleware enforces access control; these directives are
        // a courtesy to well-behaved crawlers, not a security boundary.
        disallow: [
          "/api/",
          "/admin/",
          "/events/",
          "/settings/",
          "/wizard/",
          "/family/",
          "/_next/",
        ],
      },
    ],
    sitemap: "https://sane.example.com/sitemap.xml",
  };
}
