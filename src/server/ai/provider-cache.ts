/**
 * Lightweight module for AI provider cache management.
 * Separated from provider.ts to avoid pulling heavy SDK dependencies
 * into modules that only need cache invalidation (e.g., admin router).
 */

interface CachedProvider {
  provider: unknown;
  expiresAt: number;
}

// Shared mutable object — mutations visible across all importers
export const providerCache: { entry: CachedProvider | null } = {
  entry: null,
};

export function invalidateProviderCache(): void {
  providerCache.entry = null;
}
