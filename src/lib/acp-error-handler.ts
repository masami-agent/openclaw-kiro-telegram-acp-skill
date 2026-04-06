// ============================================================
// ACP Error Handler — Handle ACP-level permission and connection errors
// Requirements: 14.1, 14.2, 14.3, 14.4, 14.5
// ============================================================

import type { AcpErrorResult } from "../types/index.js";

/**
 * Identify ACP permission-related errors and generate fix suggestions.
 *
 * Processing order:
 * 1. AccessDeniedException → suggest running `openclaw acp pair`
 * 2. pairing required → suggest checking pairing status
 * 3. scope-related keywords → suggest checking scope permissions
 * 4. Unrecognized → generic ACP error message, suggest running `npm run validate`
 *
 * In all cases, the full raw error is logged to stderr.
 *
 * @param rawError - Raw error message returned by the agent call
 * @returns AcpErrorResult containing identification result, user message, and fix suggestions
 */
export function handleAcpError(rawError: string): AcpErrorResult {
  // Log full raw error to stderr
  process.stderr.write(`[ACP Error] Raw error: ${rawError}\n`);

  // 1. AccessDeniedException
  if (/AccessDeniedException/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 Insufficient ACP permissions. Please perform device pairing.",
      fixSuggestions: [
        "Run `openclaw acp pair` to complete device pairing",
        "After completion, confirm the required scope permissions have been approved",
      ],
      debugMessage: rawError,
    };
  }

  // 2. pairing required
  if (/pairing\s+required/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 Device pairing required. Please refer to the installation guide.",
      fixSuggestions: [
        "Check device pairing status: `openclaw acp status`",
        "If not yet paired, run `openclaw acp pair`",
        "For detailed steps, see the ACP Device Pairing section in INSTALL.md",
      ],
      debugMessage: rawError,
    };
  }

  // 3. scope-related keywords
  if (/\bscope\b/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 Insufficient ACP scope permissions. Please confirm the required permissions have been approved.",
      fixSuggestions: [
        "Confirm the required scope permissions have been approved",
        "Run `openclaw acp status` to view currently approved scopes",
        "If additional scopes are needed, re-run `openclaw acp pair`",
      ],
      debugMessage: rawError,
    };
  }

  // 4. Unrecognized → generic ACP error
  return {
    isAcpError: false,
    userMessage: "⚠️ An unexpected ACP error occurred. Please run `npm run validate` for a health check.",
    fixSuggestions: [
      "Run `npm run validate` for a health check",
      "If the issue persists, check whether `openclaw acp` is working properly",
    ],
    debugMessage: rawError,
  };
}
