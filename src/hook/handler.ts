// ============================================================
// Hook Handler — OpenClaw event handler, integrates all modules for message routing
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
// 設定載入（模組層級，僅載入一次）
// ============================================================

let config: SkillConfig;
try {
  config = loadConfig();
} catch (err: unknown) {
  process.stderr.write(
    `[hook] Failed to load config: ${(err as Error).message}\n`,
  );
  // 使用預設值作為 fallback，避免 hook 完全無法載入
  config = {
    kiroAgentName: "kiro",
    kiroTimeoutMs: 120_000,
    allowedChatIds: [],
    replyPrefix: "🤖 Kiro",
    debugMode: false,
  };
}

// ============================================================
// Provider 錯誤頻率追蹤（需求 15.5）
// 同一使用者 5 分鐘內連續 3 次 provider 錯誤時額外提示
// ============================================================

const PROVIDER_ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 分鐘
const PROVIDER_ERROR_THRESHOLD = 3;

/** chatId → 錯誤時間戳記陣列 */
const providerErrorTracker = new Map<string, number[]>();

/**
 * 記錄一次 provider 錯誤，並回傳是否已達到頻率閾值。
 */
export function trackProviderError(chatId: string): boolean {
  const now = Date.now();
  let timestamps = providerErrorTracker.get(chatId);

  if (!timestamps) {
    timestamps = [];
    providerErrorTracker.set(chatId, timestamps);
  }

  timestamps.push(now);

  // 清除超出視窗的舊記錄
  const cutoff = now - PROVIDER_ERROR_WINDOW_MS;
  const filtered = timestamps.filter((t) => t > cutoff);
  providerErrorTracker.set(chatId, filtered);

  return filtered.length >= PROVIDER_ERROR_THRESHOLD;
}

/**
 * 清除指定 chatId 的 provider 錯誤追蹤記錄。
 * 主要供測試使用。
 */
export function clearProviderErrors(chatId?: string): void {
  if (chatId) {
    providerErrorTracker.delete(chatId);
  } else {
    providerErrorTracker.clear();
  }
}

// ============================================================
// Telegram 訊息傳送
// ============================================================

/**
 * 從 ~/.openclaw/openclaw.json 讀取 bot token。
 * 使用 readFileSync 確保同步取得（避免 race condition）。
 */
function getBotToken(): string {
  const cfgPath = `${process.env.HOME}/.openclaw/openclaw.json`;
  const raw = readFileSync(cfgPath, "utf8");
  const cfg = JSON.parse(raw);
  return cfg.channels.telegram.botToken;
}

/**
 * 透過 Telegram Bot API 傳送訊息。
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
// Agent 呼叫
// ============================================================

/**
 * Call agent via `openclaw agent --message --json` (non-blocking).
 *
 * One-shot CLI command that waits for agent reply and outputs to stdout.
 * Uses --session-id for cross-message memory (same chatId uses same session).
 * Uses --json for structured reply parsing.
 *
 * - stdout → JSON reply (result.payloads[0].text)
 * - stderr → diagnostic messages
 * - exit code 0 → success, non-zero → error
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
 * 從 `openclaw agent --json` 的 stdout 解析回覆文字。
 * JSON 格式：{ result: { payloads: [{ text: "..." }] } }
 */
function parseAgentResponse(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    const text = parsed?.result?.payloads?.[0]?.text;
    if (typeof text === "string" && text.length > 0) {
      return text;
    }
  } catch {
    // 非 JSON 格式，直接回傳原始文字
  }
  return stdout.trim();
}

// ============================================================
// 輔助函式
// ============================================================

/**
 * 從 OpenClaw event context 提取 Telegram chat ID。
 * OpenClaw 使用 `conversationId` 並帶有 `telegram:` 前綴。
 */
function extractChatId(event: OpenClawEvent): string {
  const raw = String(event?.context?.conversationId ?? event?.context?.from ?? "");
  return raw.replace(/^telegram:/, "");
}

// ============================================================
// 核心處理邏輯
// ============================================================

/**
 * 處理 /kiro 指令：呼叫 ACP Wrapper 並傳送回覆至 Telegram。
 */
async function handleKiroQuery(chatId: string, query: string, sessionId: string): Promise<void> {
  try {
    const result = await callAgent(query, sessionId);

    if (result.exitCode !== 0) {
      // 錯誤路徑：透過 Error Formatter 處理
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");

      // 先嘗試 ACP Error Handler（辨識權限類錯誤）
      const acpResult = handleAcpError(combined);
      if (acpResult.isAcpError) {
        const message = `${config.replyPrefix}\n\n${acpResult.userMessage}\n\n${acpResult.fixSuggestions.join("\n")}`;
        await sendTelegram(chatId, message);
        return;
      }

      // 使用通用 Error Formatter
      const formatted = formatError(combined, result.exitCode);

      // 記錄完整錯誤至 stderr（需求 15.4）
      const timestamp = new Date().toISOString();
      const promptSummary = query.slice(0, 50);
      process.stderr.write(
        `[hook] ${timestamp} Provider/ACP error for chatId=${chatId} prompt="${promptSummary}" raw=${formatted.debugMessage}\n`,
      );

      let userMessage = `${config.replyPrefix}\n\n${formatted.userMessage}`;

      // Provider 錯誤頻率追蹤（需求 15.5）
      if (formatted.errorType === "provider") {
        const exceeded = trackProviderError(chatId);
        if (exceeded) {
          userMessage += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
        }
      }

      await sendTelegram(chatId, userMessage);
      return;
    }

    // 成功路徑：解析 JSON 回覆並檢查 provider 錯誤（需求 15.3）
    const replyText = parseAgentResponse(result.stdout);
    if (!replyText) {
      await sendTelegram(chatId, `${config.replyPrefix}\n\n⚠️ 收到空白回覆，請稍後再試。`);
      return;
    }

    // 檢查回覆是否包含 provider 錯誤
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
        userMessage += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
      }

      await sendTelegram(chatId, userMessage);
      return;
    }

    // 正常回覆
    await sendTelegram(chatId, `${config.replyPrefix}\n\n${replyText}`);
  } catch (err: unknown) {
    // 最後防線：任何未預期的錯誤
    process.stderr.write(
      `[hook] Unexpected error handling /kiro query: ${(err as Error).message}\n`,
    );
    try {
      await sendTelegram(
        chatId,
        `${config.replyPrefix}\n\n⚠️ Kiro 暫時無法處理您的請求，請稍後再試。`,
      );
    } catch {
      // 連 Telegram 都無法傳送，只能記錄至 stderr
      process.stderr.write(`[hook] Failed to send error message to Telegram\n`);
    }
  }
}

// ============================================================
// Hook Handler（default export，符合 OpenClaw hook 慣例）
// ============================================================

/**
 * OpenClaw Hook Handler — 處理 message:received 與 message:sending 事件。
 *
 * message:received（void hook）：
 *   驗證 channel、chatId、/kiro prefix → markSession()（同步）
 *   → getKiroSessionId() → execFile 呼叫 ACP Wrapper → Error Formatter → Telegram
 *
 * message:sending（可回傳 { cancel: true }）：
 *   shouldCancel() 檢查是否需取消主 agent 回覆
 */
const handler = (event: OpenClawEvent): void | { cancel: true } => {
  // ── message:sending ─────────────────────────────────────────
  // 取消主 OpenClaw agent 回覆（當 /kiro 指令正在處理時）。
  // 只有 message:sending 支援 { cancel: true } 回傳值。
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

  // 僅處理 Telegram direct message session（需求 13.1, 13.2）
  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;

  // 檢查 /kiro 前綴
  if (!content || !content.startsWith("/kiro")) return;

  // ALLOWED_CHAT_IDS 過濾（空陣列 = 不限制）
  if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
    return;
  }

  // 同步標記 session（需求 12.3）
  // 必須在任何 async 操作之前完成，確保 message:sending 能偵測到標記
  markSession(sessionKey);

  // 取得固定的 Kiro session ID（需求 13.5）
  // 同一 chatId 永遠對應同一 session，實現跨訊息記憶
  const kiroSessionId = getKiroSessionId(chatId);

  // 解析 prompt
  const query = content.replace(/^\/kiro\s*/, "").trim();
  if (!query) {
    void sendTelegram(chatId, `${config.replyPrefix}\n\nUsage: /kiro <your question>`);
    return;
  }

  // 非同步呼叫 ACP Wrapper（不阻塞 gateway event loop）
  void handleKiroQuery(chatId, query, kiroSessionId);
};

export default handler;

// 匯出內部函式供測試使用
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
