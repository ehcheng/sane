/**
 * Sanitize a returnTo URL to prevent open redirects.
 * Only allows relative paths starting with "/" — no protocol or double-slash tricks.
 */
export function sanitizeReturnTo(returnTo: string | null | undefined, fallback: string): string {
  if (!returnTo || typeof returnTo !== "string") return fallback;
  // Must start with "/" but not "//" (protocol-relative) and must not contain "://"
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("://")) {
    return fallback;
  }
  return returnTo;
}
