// ============================================================
// Reply Suppressor — Manage pending session marks to ensure the message:sending
// hook can reliably cancel the main agent reply
// Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
// ============================================================

import type { SuppressionLog } from "../types/index.js";

/** Default TTL: 30 seconds (milliseconds) */
const DEFAULT_TTL_MS = 30_000;

/** Maximum log entries to retain */
const MAX_LOG_ENTRIES = 100;

/**
 * Store session key → mark timestamp (Date.now()).
 * Uses Map for O(1) lookup and deletion.
 */
const sessionStore: Map<string, number> = new Map();

/** Operation log (ring buffer, retains up to MAX_LOG_ENTRIES) */
const logs: SuppressionLog[] = [];

/**
 * Write log to stderr and add to the internal log array.
 */
function addLog(sessionKey: string, action: SuppressionLog["action"]): void {
  const timestamp = Date.now();
  const entry: SuppressionLog = { sessionKey, timestamp, action };

  // Log to stderr (with session key and timestamp)
  process.stderr.write(
    `[ReplySuppressor] ${action} session="${sessionKey}" at=${timestamp}\n`,
  );

  // Maintain log size limit
  if (logs.length >= MAX_LOG_ENTRIES) {
    logs.shift();
  }
  logs.push(entry);
}

/**
 * Purge expired session marks (TTL has exceeded DEFAULT_TTL_MS).
 */
function purgeExpired(): void {
  const now = Date.now();
  for (const [key, markedAt] of sessionStore) {
    if (now - markedAt >= DEFAULT_TTL_MS) {
      sessionStore.delete(key);
      addLog(key, "expired");
    }
  }
}

/**
 * Mark a session as pending (called during the message:received phase).
 *
 * This is a synchronous operation to ensure the mark is set before any async
 * operations (such as agent calls), preventing the message:sending hook
 * from missing the cancel signal due to timing issues.
 */
export function markSession(sessionKey: string): void {
  purgeExpired();
  sessionStore.set(sessionKey, Date.now());
  addLog(sessionKey, "marked");
}

/**
 * Check and consume a session mark (called during the message:sending phase).
 *
 * Returns true if the main agent reply should be cancelled (return `{ cancel: true }`).
 * After consumption, the mark is cleared to avoid affecting subsequent non-`/kiro`
 * messages' normal processing.
 *
 * @returns true if the session is marked and not expired, false otherwise
 */
export function shouldCancel(sessionKey: string): boolean {
  purgeExpired();

  const markedAt = sessionStore.get(sessionKey);
  if (markedAt === undefined) {
    return false;
  }

  // Check if within TTL
  if (Date.now() - markedAt >= DEFAULT_TTL_MS) {
    sessionStore.delete(sessionKey);
    addLog(sessionKey, "expired");
    return false;
  }

  // Consume the mark (one-time use)
  sessionStore.delete(sessionKey);
  addLog(sessionKey, "cancelled");
  return true;
}

/**
 * Get recent suppression operation logs for debugging.
 *
 * @param count - Number of log entries to return, default 10
 * @returns Array of recent SuppressionLog entries (oldest to newest)
 */
export function getRecentLogs(count: number = 10): SuppressionLog[] {
  const start = Math.max(0, logs.length - count);
  return logs.slice(start);
}
