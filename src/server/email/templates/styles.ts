/**
 * Shared email template styles.
 *
 * All email templates use the same structural layout and base typography.
 * Templates that need to tweak a value can spread and override:
 *   { ...emailStyles.messageText, margin: "0 0 16px 0" }
 */
import type React from "react";

export const emailStyles = {
  body: {
    backgroundColor: "#ffffff",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
    margin: 0,
    padding: 0,
  },

  container: {
    margin: "0 auto",
    maxWidth: "640px",
    padding: "0",
  },

  header: {
    padding: "16px 20px",
    borderBottom: "1px solid #e5e7eb",
  },

  brandText: {
    color: "#6b7280",
    fontSize: "14px",
    fontWeight: 600,
    margin: 0,
  },

  content: {
    padding: "24px 20px",
  },

  heading: {
    color: "#1a1a2e",
    fontSize: "20px",
    fontWeight: 700,
    lineHeight: "1.3",
    margin: "0 0 12px 0",
  },

  messageText: {
    color: "#374151",
    fontSize: "16px",
    lineHeight: "1.6",
    margin: "0 0 24px 0",
  },

  buttonSection: {
    textAlign: "center" as const,
    margin: "0 0 16px 0",
  },

  button: {
    backgroundColor: "#3b82f6",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "1",
    padding: "14px 32px",
    textDecoration: "none",
    textAlign: "center" as const,
  },

  metaText: {
    color: "#9ca3af",
    fontSize: "14px",
    lineHeight: "1.4",
    margin: 0,
    textAlign: "center" as const,
  },

  divider: {
    borderColor: "#e5e7eb",
    borderStyle: "solid",
    borderWidth: "1px 0 0 0",
    margin: "0 20px",
  },

  footer: {
    padding: "16px 20px",
  },

  footerText: {
    color: "#9ca3af",
    fontSize: "13px",
    lineHeight: "1.5",
    margin: "0 0 4px 0",
    textAlign: "center" as const,
  },

  footerBrand: {
    color: "#9ca3af",
    fontSize: "12px",
    lineHeight: "1.5",
    margin: 0,
    textAlign: "center" as const,
  },
} satisfies Record<string, React.CSSProperties>;
