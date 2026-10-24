/**
 * Provider-agnostic token manager.
 *
 * Re-exports Gmail token functions and adds provider dispatch for refresh.
 * When Outlook support is added, this module will dispatch to the appropriate
 * refresh logic based on the provider field on EmailConnection.
 */

// Re-export encrypt/decrypt (provider-agnostic — they're just AES wrappers)
export { encryptTokens, decryptTokens } from "@/server/gmail/token-manager";

// Re-export the high-level accessor (queries emailConnection internally)
export { getValidAccessToken } from "@/server/gmail/token-manager";

// Re-export refresh for direct use
export { refreshAccessToken } from "@/server/gmail/token-manager";
