// ============================================================
// Session Isolator — Ensure /kiro messages do not leak into the main agent's
// conversation context, and maintain a fixed Kiro session ID per Telegram user
// to enable cross-message memory
// Requirements: 13.1, 13.2, 13.5
// ============================================================

/** Session ID prefix, completely separated from the main agent's session key namespace */
const SESSION_PREFIX = "kiro-telegram-";

/**
 * Generate a fixed Kiro session ID based on the Telegram chat ID.
 *
 * The same chat ID always maps to the same session, allowing kiro-cli to
 * remember conversation history.
 * Format: `kiro-telegram-{chatId}`
 *
 * This namespace is completely different from the OpenClaw main agent's session key
 * (`agent:main:telegram:direct:{chatId}`), so they do not interfere with each other.
 *
 * @param chatId - Telegram chat ID
 * @returns Fixed-format Kiro session ID
 */
export function getKiroSessionId(chatId: string): string {
  return `${SESSION_PREFIX}${chatId}`;
}

/**
 * Document the known limitations of the OpenClaw hook mechanism for session isolation.
 *
 * These limitations stem from the OpenClaw platform's hook architecture design and
 * cannot be fully resolved at the skill level. They are documented in INSTALL.md
 * with alternative solutions provided.
 *
 * @returns Array of known limitation strings
 */
export function getIsolationLimitations(): string[] {
  return [
    "OpenClaw's message:received hook cannot prevent messages from entering the main agent's context window. " +
      "/kiro message content may still be visible to the main agent.",
    "It is recommended to add a directive in SOUL.md instructing the main agent to ignore messages starting with /kiro, " +
      "as a supplementary measure to hook-level isolation.",
    "Sessions may disappear after kiro-cli restarts. The agent call needs to handle the case where a session does not exist " +
      "(automatically rebuild via acp/createSession).",
    "Kiro sessions across different Telegram chats are isolated, but all /kiro messages within the same chat " +
      "share a single session (by design, for cross-message memory).",
  ];
}
