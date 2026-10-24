import { trpc } from "@/lib/trpc";

/** Browser timezone, computed once at module load (never changes during a session). */
const BROWSER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Single source of truth for the display timezone on the frontend.
 *
 * Returns the user's configured timezone from their profile. Falls back
 * to the browser's timezone while the user query is still loading, which
 * prevents a flash of wrong dates on first render.
 *
 * Future: could layer in a "viewing timezone" override that takes
 * precedence over the profile timezone (e.g. for traveling users).
 */
export function useTimezone(): string {
  const { data: user } = trpc.user.me.useQuery();
  return user?.timezone ?? BROWSER_TZ;
}
