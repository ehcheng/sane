// ---------------------------------------------------------------------------
// Structured JSON logging
//
// All output is JSON for easy parsing/filtering in production.
// DEBUG toggle: env var or DB-driven override via setDebugOverride().
// ---------------------------------------------------------------------------

let debugOverride: boolean | undefined;

function isDebug(): boolean {
  return debugOverride ?? true;
}

/** Allow DB-driven debug toggle (call from config loader). */
function setDebugOverride(v: boolean): void {
  debugOverride = v;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return JSON.stringify({ error: "Failed to serialize log entry" });
  }
}

function emit(
  level: string,
  consoleFn: (...args: unknown[]) => void,
  tag: string,
  msg: string,
  data?: Record<string, unknown>
): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    tag,
    msg,
  };
  if (data && Object.keys(data).length > 0) {
    entry.data = data;
  }
  consoleFn(safeStringify(entry));
}

const logger = {
  isDebug,
  setDebugOverride,

  info(tag: string, msg: string, data?: Record<string, unknown>): void {
    emit("INFO", console.log, tag, msg, data);
  },

  warn(tag: string, msg: string, data?: Record<string, unknown>): void {
    emit("WARN", console.warn, tag, msg, data);
  },

  debug(tag: string, msg: string, data?: Record<string, unknown>): void {
    if (!isDebug()) return;
    emit("DEBUG", console.log, tag, msg, data);
  },

  error(tag: string, msg: string, data?: Record<string, unknown>): void {
    emit("ERROR", console.error, tag, msg, data);
  },

  /** Logs the full AI prompt (debug only). */
  aiPrompt(tag: string, prompt: string): void {
    if (!isDebug()) return;
    emit("DEBUG", console.log, tag, "AI prompt", { prompt });
  },

  /** Logs the full AI response (debug only). */
  aiResponse(tag: string, raw: string, parsed: Record<string, unknown>): void {
    if (!isDebug()) return;
    emit("DEBUG", console.log, tag, "AI response", { raw, parsed });
  },
};

// ---------------------------------------------------------------------------
// In-memory counters (reset on process restart)
// ---------------------------------------------------------------------------

let processed = 0;
let forwarded = 0;
let skipped = 0;

export function countProcessed(): number {
  return ++processed;
}

export function countForwarded(): number {
  return ++forwarded;
}

export function countSkipped(): number {
  return ++skipped;
}

export function printCounters(tag: string): void {
  logger.info(tag, "Session totals", {
    processed,
    forwarded,
    skipped,
  });
}

export function getCounters() {
  return { processed, forwarded, skipped };
}

export default logger;
