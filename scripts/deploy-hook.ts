/**
 * Generate a standalone handler.ts deployable directly to the OpenClaw hooks directory.
 * Integrates all improvement features with no external npm module dependencies.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const HOOKS_DIR = join(homedir(), ".openclaw", "workspace", "hooks", "kiro-command");
const HANDLER_PATH = join(HOOKS_DIR, "handler.ts");

const handlerCode = `
import { readFileSync, appendFileSync } from "fs";
import { execFile } from "child_process";

// ============================================================
// Configuration
// ============================================================

const COMMAND_PREFIX = "/kiro";
const ALLOWED_CHAT_IDS: string[] = []; // empty = no restrictions
const AGENT_TIMEOUT = 120_000;
const LOG_FILE = "/tmp/kiro-hook-debug.log";
const REPLY_PREFIX = "🤖 Kiro";

// ============================================================
// Reply Suppressor (Requirement 12)
// Uses synchronous marking to ensure message:sending can reliably cancel the main agent reply
// ============================================================

const pendingKiroSessions = new Map<string, number>();
const SESSION_TTL_MS = 30_000;

function markSession(sessionKey: string): void {
  // Purge expired marks
  const now = Date.now();
  for (const [key, ts] of pendingKiroSessions) {
    if (now - ts >= SESSION_TTL_MS) pendingKiroSessions.delete(key);
  }
  pendingKiroSessions.set(sessionKey, now);
  log(\`MARK session=\${sessionKey}\`);
}

function shouldCancel(sessionKey: string): boolean {
  const ts = pendingKiroSessions.get(sessionKey);
  if (ts === undefined) return false;
  if (Date.now() - ts >= SESSION_TTL_MS) {
    pendingKiroSessions.delete(sessionKey);
    return false;
  }
  pendingKiroSessions.delete(sessionKey);
  log(\`CANCEL session=\${sessionKey}\`);
  return true;
}

// ============================================================
// Session Isolator (Requirement 13)
// Uses fixed session IDs for cross-message memory
// ============================================================

function getKiroSessionId(chatId: string): string {
  return \`kiro-telegram-\${chatId}\`;
}

// ============================================================
// Error Formatter (Requirements 11, 15)
// ============================================================

interface ErrorMapping {
  pattern: RegExp;
  type: string;
  message: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  { pattern: /"code"\\s*:\\s*-32603/, type: "json_rpc", message: "⚠️ Internal service error. Please try again later." },
  { pattern: /"code"\\s*:\\s*-32600/, type: "json_rpc", message: "⚠️ Invalid request format. Please try again." },
  { pattern: /"code"\\s*:\\s*-32601/, type: "json_rpc", message: "⚠️ The specified service method does not exist. Please check the configuration." },
  { pattern: /finish_reason\\s*:\\s*error|finish_reason.*error/i, type: "provider", message: "⚠️ The AI service is temporarily unavailable. Please try again later." },
  { pattern: /rate_limit/i, type: "provider", message: "⚠️ AI service rate limit exceeded. Please try again later." },
  { pattern: /context_length_exceeded/i, type: "provider", message: "⚠️ Message too long. Please shorten it and try again." },
  { pattern: /model_not_found/i, type: "provider", message: "⚠️ AI model configuration error. Please contact the administrator." },
  { pattern: /AccessDeniedException/i, type: "acp_permission", message: "🔐 Insufficient ACP permissions. Please run openclaw acp pair to complete device pairing." },
  { pattern: /pairing required/i, type: "acp_permission", message: "🔐 Device pairing required. Please refer to the installation guide." },
  { pattern: /timeout|timed?\\s*out/i, type: "timeout", message: "⏱️ Kiro response timed out. Please try again later." },
];

function formatError(raw: string, exitCode: number): { message: string; type: string } {
  if (exitCode === 3) return { message: "⏱️ Kiro response timed out. Please try again later.", type: "timeout" };
  for (const m of ERROR_MAPPINGS) {
    if (m.pattern.test(raw)) return { message: m.message, type: m.type };
  }
  return { message: "⚠️ Kiro is temporarily unable to process your request. Please try again later.", type: "unknown" };
}

// ============================================================
// Provider error frequency tracking (Requirement 15.5)
// ============================================================

const providerErrors = new Map<string, number[]>();

function trackProviderError(chatId: string): boolean {
  const now = Date.now();
  let timestamps = providerErrors.get(chatId) || [];
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < 300_000); // 5-minute window
  providerErrors.set(chatId, timestamps);
  return timestamps.length >= 3;
}

// ============================================================
// Utility functions
// ============================================================

function log(msg: string) {
  appendFileSync(LOG_FILE, \`[\${new Date().toISOString()}] \${msg}\\n\`);
}

function getBotToken(): string {
  const cfg = JSON.parse(
    readFileSync(process.env.HOME + "/.openclaw/openclaw.json", "utf8")
  );
  return cfg.channels.telegram.botToken;
}

async function sendTelegram(chatId: string, text: string) {
  const token = getBotToken();
  const res = await fetch(
    \`https://api.telegram.org/bot\${token}/sendMessage\`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  const data = await res.json();
  if (!data.ok) log(\`Telegram send failed: \${JSON.stringify(data)}\`);
}

// ============================================================
// Agent invocation (using openclaw agent --message --json)
// ============================================================

function queryAgent(prompt: string, sessionId: string): Promise<{ text: string; exitCode: number; raw: string }> {
  return new Promise((resolve) => {
    execFile(
      "openclaw",
      ["agent", "--session-id", sessionId, "--message", prompt, "--json"],
      { timeout: AGENT_TIMEOUT, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          const exitCode = (err as any).killed ? 3 : ((err as any).status || 2);
          resolve({ text: "", exitCode, raw: [stdout, stderr, err.message].filter(Boolean).join("\\n") });
          return;
        }
        // Parse JSON reply
        try {
          const parsed = JSON.parse(stdout);
          const text = parsed?.result?.payloads?.[0]?.text;
          if (text) {
            resolve({ text, exitCode: 0, raw: stdout });
            return;
          }
        } catch {}
        resolve({ text: stdout.trim(), exitCode: 0, raw: stdout });
      }
    );
  });
}

// ============================================================
// Core processing logic
// ============================================================

async function handleKiroQuery(chatId: string, query: string, sessionId: string) {
  try {
    log(\`Querying agent: \${query} sessionId=\${sessionId}\`);
    const result = await queryAgent(query, sessionId);

    if (result.exitCode !== 0) {
      // Error path
      const formatted = formatError(result.raw, result.exitCode);
      log(\`Error: type=\${formatted.type} raw=\${result.raw.slice(0, 200)}\`);

      let msg = \`\${REPLY_PREFIX}\\n\\n\${formatted.message}\`;
      if (formatted.type === "provider" && trackProviderError(chatId)) {
        msg += "\\n\\nIf this issue persists, please contact the administrator to check the AI provider status.";
      }
      await sendTelegram(chatId, msg);
      return;
    }

    if (!result.text) {
      await sendTelegram(chatId, \`\${REPLY_PREFIX}\\n\\n⚠️ Received an empty reply. Please try again later.\`);
      return;
    }

    // Check if the reply contains a provider error
    const formatted = formatError(result.text, 0);
    if (formatted.type === "provider") {
      log(\`Provider error in reply: \${result.text.slice(0, 200)}\`);
      let msg = \`\${REPLY_PREFIX}\\n\\n\${formatted.message}\`;
      if (trackProviderError(chatId)) {
        msg += "\\n\\nIf this issue persists, please contact the administrator to check the AI provider status.";
      }
      await sendTelegram(chatId, msg);
      return;
    }

    log(\`Reply: \${result.text.slice(0, 200)}\`);
    await sendTelegram(chatId, \`\${REPLY_PREFIX}\\n\\n\${result.text}\`);
  } catch (err: any) {
    log(\`Unexpected error: \${err?.message || String(err)}\`);
    try {
      await sendTelegram(chatId, \`\${REPLY_PREFIX}\\n\\n⚠️ Kiro is temporarily unable to process your request. Please try again later.\`);
    } catch {}
  }
}

// ============================================================
// Hook Handler
// ============================================================

const handler = (event: any) => {
  // message:sending — cancel main agent reply
  if (event?.type === "message" && event?.action === "sending") {
    const sessionKey = String(event?.sessionKey || "");
    if (shouldCancel(sessionKey)) {
      return { cancel: true };
    }
    return;
  }

  // message:received
  if (event?.type !== "message" || event?.action !== "received") return;
  if (event?.context?.channelId !== "telegram") return;

  const content = event?.context?.content;
  const rawId = String(event?.context?.conversationId || event?.context?.from || "");
  const chatId = rawId.replace(/^telegram:/, "");
  const sessionKey = String(event?.sessionKey || "");

  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;
  if (!content || !content.startsWith(COMMAND_PREFIX)) return;
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(chatId)) return;

  // Synchronously mark session (Requirement 12.3)
  markSession(sessionKey);

  // Get fixed Kiro session ID (Requirement 13.5)
  const kiroSessionId = getKiroSessionId(chatId);

  const query = content.replace(/^\\/kiro\\s*/, "").trim();
  if (!query) {
    pendingKiroSessions.set(sessionKey, Date.now()); // Ensure usage message also cancels main agent
    sendTelegram(chatId, \`\${REPLY_PREFIX}\\n\\nUsage: /kiro <your question>\`);
    return;
  }

  log(\`KIRO QUERY: \${query} from chatId=\${chatId} session=\${kiroSessionId}\`);
  void handleKiroQuery(chatId, query, kiroSessionId);
};

export default handler;
`.trim();

// Write file
mkdirSync(HOOKS_DIR, { recursive: true });
writeFileSync(HANDLER_PATH, handlerCode, "utf-8");
console.log(`✓ Hook handler deployed to ${HANDLER_PATH}`);
