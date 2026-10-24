import logger from "@/lib/logger";
import { executeDiagnosticRun } from "./diagnostic-checks";

const TAG = "manual-diagnostics";

/**
 * Manual diagnostics run (triggered from admin UI).
 * Runs all diagnostic checks and stores results in the DB.
 * Does NOT send an email (the daily heartbeat handles that).
 */
export async function processManualDiagnostics(): Promise<void> {
  logger.info(TAG, "Starting manual diagnostics run...");
  await executeDiagnosticRun(TAG, { rethrow: true });
}
