// ============================================================
// Error Formatter — Convert raw technical errors to user-friendly messages
// Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 15.1, 15.2, 15.3
// ============================================================

import type { ErrorMapping, ErrorType, FormattedError } from "../types/index.js";

/** Maximum length for user messages */
const MAX_USER_MESSAGE_LENGTH = 200;

/**
 * Error code mapping table, matched in priority order.
 * Covers JSON-RPC errors, provider errors, timeout, ACP permission, and unknown.
 */
export const ERROR_MAPPINGS: ErrorMapping[] = [
  // --- JSON-RPC errors ---
  {
    pattern: /"code"\s*:\s*-32603/,
    errorType: "json_rpc",
    userMessage: "⚠️ Internal service error. Please try again later.",
  },
  {
    pattern: /"code"\s*:\s*-32600/,
    errorType: "json_rpc",
    userMessage: "⚠️ Invalid request format. Please try again.",
  },
  {
    pattern: /"code"\s*:\s*-32601/,
    errorType: "json_rpc",
    userMessage: "⚠️ The specified service method does not exist. Please check the configuration.",
  },
  // --- Provider errors ---
  {
    pattern: /finish_reason\s*:\s*error|finish_reason.*error/i,
    errorType: "provider",
    userMessage: "⚠️ The AI service is temporarily unavailable. Please try again later.",
  },
  {
    pattern: /rate_limit/i,
    errorType: "provider",
    userMessage: "⚠️ AI service rate limit exceeded. Please try again later.",
  },
  {
    pattern: /context_length_exceeded/i,
    errorType: "provider",
    userMessage: "⚠️ Message too long. Please shorten it and try again.",
  },
  {
    pattern: /model_not_found/i,
    errorType: "provider",
    userMessage: "⚠️ AI model configuration error. Please contact the administrator.",
  },
  // --- ACP permission errors ---
  {
    pattern: /AccessDeniedException/i,
    errorType: "acp_permission",
    userMessage: "🔐 Insufficient ACP permissions. Please perform device pairing.",
  },
  {
    pattern: /pairing required/i,
    errorType: "acp_permission",
    userMessage: "🔐 Device pairing required. Please refer to the installation guide.",
  },
  // --- Timeout (exit code 3 handled in formatError) ---
  {
    pattern: /timeout|timed?\s*out/i,
    errorType: "timeout",
    userMessage: "⏱️ Kiro response timed out. Please try again later.",
  },
];

/** Generic unknown error message */
const UNKNOWN_ERROR_MESSAGE = "⚠️ Kiro is temporarily unable to process your request. Please try again later.";

/** Timeout error message */
const TIMEOUT_ERROR_MESSAGE = "⏱️ Kiro response timed out. Please try again later.";

/**
 * Remove sensitive information: request_id, stack traces, internal endpoints, etc.
 */
export function sanitize(message: string): string {
  let result = message;

  // Remove request_id (various formats)
  result = result.replace(/["']?request_id["']?\s*[:=]\s*["']?[a-zA-Z0-9\-_]+["']?,?\s*/gi, "");

  // Remove stack trace lines (lines starting with "at ")
  result = result.replace(/^\s*at\s+.+$/gm, "");

  // Remove common stack trace headers
  result = result.replace(/^(Error|TypeError|ReferenceError|SyntaxError|RangeError):.*\n?/gm, "");

  // Remove internal endpoint URLs (http/https URLs)
  result = result.replace(/https?:\/\/[^\s"',)}\]]+/gi, "[redacted-url]");

  // Remove consecutive blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Ensure message length does not exceed the limit; truncate with ellipsis if it does.
 */
function truncateMessage(message: string, maxLength: number = MAX_USER_MESSAGE_LENGTH): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.slice(0, maxLength - 1) + "…";
}

/**
 * Parse ACP Wrapper stdout/stderr output, identify error type, and format.
 *
 * @param rawOutput - Raw output from the ACP Wrapper (stdout + stderr)
 * @param exitCode - ACP Wrapper exit code (0=success, 1=usage, 2=connection failure, 3=timeout)
 * @returns FormattedError containing user message, debug message, and error classification
 */
export function formatError(rawOutput: string, exitCode: number): FormattedError {
  const debugMessage = rawOutput;

  // Prioritize exit code 3 (timeout)
  if (exitCode === 3) {
    return {
      userMessage: truncateMessage(TIMEOUT_ERROR_MESSAGE),
      debugMessage,
      errorType: "timeout",
    };
  }

  // Match against error mapping table in order
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(rawOutput)) {
      return {
        userMessage: truncateMessage(mapping.userMessage),
        debugMessage,
        errorType: mapping.errorType,
      };
    }
  }

  // Unrecognized error → generic message
  return {
    userMessage: truncateMessage(UNKNOWN_ERROR_MESSAGE),
    debugMessage,
    errorType: "unknown",
  };
}
