import { prisma } from "@/server/db/prisma";

/** Module-level cache: once an admin exists, never query again. */
let setupComplete = false;

/**
 * Returns true if no users exist in the database (first-run state).
 * Result is cached in-memory — once a user exists, this always returns false
 * without hitting the DB again for the lifetime of the process.
 */
export async function needsFirstRunSetup(): Promise<boolean> {
  if (setupComplete) return false;

  const count = await prisma.user.count({ take: 1 });
  if (count > 0) {
    setupComplete = true;
    return false;
  }
  return true;
}

/** Mark setup as complete (called after admin creation to avoid extra query). */
export function markSetupComplete(): void {
  setupComplete = true;
}
