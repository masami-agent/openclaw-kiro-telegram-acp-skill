// ============================================================
// Hook Handler — OpenClaw event handler, integrating all modules for message routing
// Requirements: 6.1, 6.2, 6.3, 12.1–12.5, 13.1–13.3, 15.4, 15.5
// ============================================================
//
// Why use an ACP Wrapper (kiro-acp-ask) instead of calling `openclaw agent --message` CLI directly?
//
// Per docs/wrapper-contract.md:
// OpenClaw 2026.4.2's `openclaw acp` is a stdio ACP bridge server,
// not an HTTP endpoint or a one-shot CLI command. The Telegram hook needs request/response
// behavior, so using a thin wrapper (kiro-acp-ask) as a bridge is the cleanest approach.
//
// Wrapper responsibilities:
// 1. Accept agent name and prompt as command-line arguments
// 2. Communicate with the `openclaw acp` bridge via stdio JSON-RPC
// 3. Output only the final reply text to stdout
// 4. Return a non-zero exit code on failure
// 5. Output debug/error messages to stderr
//
// Uses `execFile` (not `execSync`) to avoid blocking the gateway event loop.
// ============================================================

import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { markSession, shouldCancel } from "../lib/reply-suppressor.js";
import { getKiroSessionId } from "../lib/session-isolator.js";
import { formatError } from "../lib/error-formatter.js";
import { handleAcpError } from "../lib/acp-error-handler.js";
import type { OpenClawEvent, SkillConfig } from "../types/index.js";

// ============================================================
// Config loading (module level, loaded once)
// ============================================================

let config: SkillConfig;
try {
  config = loadConfig();
} catch (err: unknown) {
  process.stderr.write(
    `[hook] Failed to load config: ${(err as Error).message}\n`,
  );
  // Use default values as fallback to prevent hook from failing to load entirely
  config = {
    kiroAgentName: "kiro",
    kiroTimeoutMs: 120_000,
    kiroWrapperCmd: "kiro-acp-ask",
    allowedChatIds: [],
    replyPrefix: "🤖 Kiro",
    debugMode: false,
  };
}

// ============================================================
// Provider error frequency tracking (Requirement 15.5)
// Show additional hint when the same user hits 3 consecutive provider errors within 5 minutes
// ============================================================

const PROVIDER_ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const PROVIDER_ERROR_THRESHOLD = 3;

/** chatId → array of error timestamps */
const providerErrorTracker = new Map<string, number[]>();

/**
 * Record a provider error and return whether the frequency threshold has been reached.
 */
export function trackProviderError(chatId: string): boolean {
  const now = Date.now();
  let timestamps = providerErrorTracker.get(chatId);

  if (!timestamps) {
    timestamps = [];
    providerErrorTracker.set(chatId, timestamps);
  }

  timestamps.push(now);

  // Remove old records outside the window
  const cutoff = now - PROVIDER_ERROR_WINDOW_MS;
  const filtered = timestamps.filter((t) => t > cutoff);
  providerErrorTracker.set(chatId, filtered);

  return filtered.length >= PROVIDER_ERROR_THRESHOLD;
}

/**
 * Clear provider error tracking records for a given chatId.
 * Primarily used for testing.
 */
export function clearProviderErrors(chatId?: string): void {
  if (chatId) {
    providerErrorTracker.delete(chatId);
  } else {
    providerErrorTracker.clear();
  }
}

// ============================================================
// Telegram message sending
// ============================================================

/**
 * Read the bot token from ~/.openclaw/openclaw.json.
 * Uses readFileSync to ensure synchronous retrieval (avoid race conditions).
 */
function getBotToken(): string {
  const cfgPath = `${process.env.HOME}/.openclaw/openclaw.json`;
  const raw = readFileSync(cfgPath, "utf8");
  const cfg = JSON.parse(raw);
  return cfg.channels.telegram.botToken;
}

/**
 * Send a message via the Telegram Bot API.
 */
async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = getBotToken();
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) {
    throw new Error(`Telegram send failed: ${JSON.stringify(data)}`);
  }
}

// ============================================================
// Agent invocation
// ============================================================

/**
 * Invoke the agent via `openclaw agent --message --json`, non-blocking.
 *
 * This is a one-shot CLI command that waits for the agent reply and outputs to stdout.
 * Uses --session-id for cross-message memory (same chatId uses the same session).
 * Uses --json for structured replies, making parsing easier.
 *
 * See docs/wrapper-contract.md:
 * - stdout → JSON-formatted reply (containing result.payloads[0].text)
 * - stderr → diagnostic messages
 * - exit code 0 → success, non-zero → error
 *
 * Note: The design doc originally planned to use `openclaw acp` stdio bridge + kiro-acp-ask wrapper,
 * but testing revealed the ACP bridge routes replies to Telegram instead of returning them to the client
 * in hook scenarios. Therefore, `openclaw agent --message --json` is used temporarily until the ACP
 * bridge issue is resolved.
 */
function callAgent(
  prompt: string,
  sessionId: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const args = [
      "agent",
      "--session-id",
      sessionId,
      "--message",
      prompt,
      "--json",
    ];

    execFile(
      "openclaw",
      args,
      {
        timeout: config.kiroTimeoutMs,
        encoding: "utf8",
        env: { ...process.env },
      },
      (err, stdout, stderr) => {
        if (err) {
          const exitCode = (err as NodeJS.ErrnoException & { code?: string | number }).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
            ? 2
            : typeof (err as any).status === "number"
              ? (err as any).status
              : (err as any).code === "ETIMEDOUT" || (err as any).killed
                ? 3
                : 2;
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? err.message,
            exitCode,
          });
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
      },
    );
  });
}

/**
 * Parse the reply text from `openclaw agent --json` stdout.
 * JSON format: { result: { payloads: [{ text: "..." }] } }
 */
function parseAgentResponse(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    const text = parsed?.result?.payloads?.[0]?.text;
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  } catch {
    // Not JSON format, return raw text
  }
  return stdout.trim();
}

// ============================================================
// Helper functions
// ============================================================

/**
 * Extract the Telegram chat ID from the OpenClaw event context.
 * OpenClaw uses `conversationId` with a `telegram:` prefix.
 */
function extractChatId(event: OpenClawEvent): string {
  const raw = String(event?.context?.conversationId ?? event?.context?.from ?? "");
  return raw.replace(/^telegram:/, "");
}

// ============================================================
// Core processing logic
// ============================================================

/**
 * Handle the /kiro command: invoke the ACP Wrapper and send the reply to Telegram.
 */
async function handleKiroQuery(chatId: string, query: string, sessionId: string): Promise<void> {
  try {
    const result = await callAgent(query, sessionId);

    if (result.exitCode !== 0) {
      // Error path: process through Error Formatter
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");

      // First try ACP Error Handler (identify permission-related errors)
      const acpResult = handleAcpError(combined);
      if (acpResult.isAcpError) {
        const message = `${config.replyPrefix}\n\n${acpResult.userMessage}\n\n${acpResult.fixSuggestions.join("\n")}`;
        await sendTelegram(chatId, message);
        return;
      }

      // Use the general Error Formatter
      const formatted = formatError(combined, result.exitCode);

      // Log full error to stderr (Requirement 15.4)
      const timestamp = new Date().toISOString();
      const promptSummary = query.slice(0, 50);
      process.stderr.write(
        `[hook] ${timestamp} Provider/ACP error for chatId=${chatId} prompt="${promptSummary}" raw=${formatted.debugMessage}\n`,
      );

      let userMessage = `${config.replyPrefix}\n\n${formatted.userMessage}`;

      // Provider error frequency tracking (Requirement 15.5)
      if (formatted.errorType === "provider") {
        const exceeded = trackProviderError(chatId);
        if (exceeded) {
          userMessage += "\n\nIf this issue persists, please contact the administrator to check the AI provider status.";
        }
      }

      await sendTelegram(chatId, userMessage);
      return;
    }

    // Success path: parse JSON reply and check for provider errors (Requirement 15.3)
    const replyText = parseAgentResponse(result.stdout);
    if (!replyText) {
      await sendTelegram(chatId, `${config.replyPrefix}\n\n⚠️ Received an empty reply. Please try again later.`);
      return;
    }

    // Check if the reply contains a provider error
    const formatted = formatError(replyText, 0);
    if (formatted.errorType === "provider") {
      const timestamp = new Date().toISOString();
      const promptSummary = query.slice(0, 50);
      process.stderr.write(
        `[hook] ${timestamp} Provider error in stdout for chatId=${chatId} prompt="${promptSummary}" raw=${replyText}\n`,
      );

      let userMessage = `${config.replyPrefix}\n\n${formatted.userMessage}`;

      const exceeded = trackProviderError(chatId);
      if (exceeded) {
        userMessage += "\n\nIf this issue persists, please contact the administrator to check the AI provider status.";
      }

      await sendTelegram(chatId, userMessage);
      return;
    }

    // Normal reply
    await sendTelegram(chatId, `${config.replyPrefix}\n\n${replyText}`);
  } catch (err: unknown) {
    // Last resort: any unexpected error
    process.stderr.write(
      `[hook] Unexpected error handling /kiro query: ${(err as Error).message}\n`,
    );
    try {
      await sendTelegram(
        chatId,
        `${config.replyPrefix}\n\n⚠️ Kiro is temporarily unable to process your request. Please try again later.`,
      );
    } catch {
      // Cannot even send to Telegram, can only log to stderr
      process.stderr.write(`[hook] Failed to send error message to Telegram\n`);
    }
  }
}

// ============================================================
// Hook Handler (default export, follows OpenClaw hook convention)
// ============================================================

/**
 * OpenClaw Hook Handler — handles message:received and message:sending events.
 *
 * message:received (void hook):
 *   Validate channel, chatId, /kiro prefix → markSession() (sync)
 *   → getKiroSessionId() → execFile to invoke ACP Wrapper → Error Formatter → Telegram
 *
 * message:sending (can return { cancel: true }):
 *   shouldCancel() checks whether to cancel the main agent reply
 */
const handler = (event: OpenClawEvent): void | { cancel: true } => {
  // ── message:sending ─────────────────────────────────────────
  // Cancel the main OpenClaw agent reply (when a /kiro command is being processed).
  // Only message:sending supports the { cancel: true } return value.
  if (event?.type === "message" && event?.action === "sending") {
    const sessionKey = String(event?.sessionKey ?? "");
    if (shouldCancel(sessionKey)) {
      return { cancel: true };
    }
    return;
  }

  // ── message:received ────────────────────────────────────────
  if (event?.type !== "message" || event?.action !== "received") return;
  if (event?.context?.channelId !== "telegram") return;

  const content = event?.context?.content;
  const chatId = extractChatId(event);
  const sessionKey = String(event?.sessionKey ?? "");

  // Only handle Telegram direct message sessions (Requirements 13.1, 13.2)
  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;

  // Check /kiro prefix
  if (!content || !content.startsWith("/kiro")) return;

  // ALLOWED_CHAT_IDS filter (empty array = no restrictions)
  if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
    return;
  }

  // Synchronously mark session (Requirement 12.3)
  // Must complete before any async operations to ensure message:sending hook can detect the mark
  markSession(sessionKey);

  // Get the fixed Kiro session ID (Requirement 13.5)
  // Same chatId always maps to the same session, enabling cross-message memory
  const kiroSessionId = getKiroSessionId(chatId);

  // Parse prompt
  const query = content.replace(/^\/kiro\s*/, "").trim();
  if (!query) {
    void sendTelegram(chatId, `${config.replyPrefix}\n\nUsage: /kiro <your question>`);
    return;
  }

  // Async invoke ACP Wrapper (non-blocking for gateway event loop)
  void handleKiroQuery(chatId, query, kiroSessionId);
};

export default handler;

// Export internal functions for testing
export {
  extractChatId,
  handleKiroQuery,
  callAgent,
  parseAgentResponse,
  sendTelegram,
  getBotToken,
  config,
  providerErrorTracker,
  PROVIDER_ERROR_WINDOW_MS,
  PROVIDER_ERROR_THRESHOLD,
};
