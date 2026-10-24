/**
 * Email provider client factory.
 *
 * Creates the appropriate EmailProviderClient based on the provider type.
 * Currently only Gmail is implemented; Outlook will be added in a future phase.
 */

import type { EmailProviderClient } from "./types";

export type { EmailProviderClient, EmailMessage, AttachmentPart, FetchOptions, MessageRef } from "./types";

/**
 * Creates an authenticated email client for the given provider.
 */
export function createEmailClient(
  provider: "GMAIL" | "OUTLOOK",
  accessToken: string,
  userId?: string,
): EmailProviderClient {
  switch (provider) {
    case "GMAIL": {
      // Lazy import to keep googleapis out of bundles that don't need it
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { GmailProviderClient } = require("./gmail/client") as typeof import("./gmail/client");
      return new GmailProviderClient(accessToken, userId);
    }
    case "OUTLOOK":
      throw new Error("Outlook provider is not yet implemented. Coming in a future release.");
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}
