import type { MetadataRoute } from "next";

// Sitemap via Next.js Metadata API.
// Serves with Content-Type: application/xml (CWE-345 remediation).
//
// Only public, unauthenticated pages are listed. Authenticated routes
// (events, settings, admin, etc.) are intentionally excluded to avoid
// exposing the existence of user-facing functionality to search engines.
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://sane.example.com";

  return [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/faq`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/contactsane`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
  ];
}
