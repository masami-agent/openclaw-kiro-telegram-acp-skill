import { readFileSync, appendFileSync } from "fs";
import { execFile } from "child_process";

// ============================================================
// 設定
// ============================================================

const COMMAND_PREFIX = "/kiro";
const ALLOWED_CHAT_IDS: string[] = []; // 空 = 不限制
const AGENT_TIMEOUT = 120_000;
const LOG_FILE = "/tmp/kiro-hook-debug.log";
const REPLY_PREFIX = "🤖 Kiro";

// ============================================================
// Reply Suppressor（需求 12）
// ============================================================

const pendingKiroSessions = new Map<string, number>();
const SESSION_TTL_MS = 30_000;

function markSession(sessionKey: string): void {
  const now = Date.now();
  for (const [key, ts] of pendingKiroSessions) {
    if (now - ts >= SESSION_TTL_MS) pendingKiroSessions.delete(key);
  }
  pendingKiroSessions.set(sessionKey, now);
  log(`MARK session=${sessionKey}`);
}

function shouldCancel(sessionKey: string): boolean {
  const ts = pendingKiroSessions.get(sessionKey);
  if (ts === undefined) return false;
  if (Date.now() - ts >= SESSION_TTL_MS) {
    pendingKiroSessions.delete(sessionKey);
    return false;
  }
  pendingKiroSessions.delete(sessionKey);
  log(`CANCEL session=${sessionKey}`);
  return true;
}

// ============================================================
// Session Isolator（需求 13）
// ============================================================

function getKiroSessionId(chatId: string): string {
  return `kiro-telegram-${chatId}`;
}

// ============================================================
// Error Formatter（需求 11, 15）
// ============================================================

const ERROR_MAPPINGS = [
  { pattern: /"code"\s*:\s*-32603/, type: "json_rpc", message: "⚠️ 服務內部錯誤，請稍後再試。" },
  { pattern: /"code"\s*:\s*-32600/, type: "json_rpc", message: "⚠️ 請求格式錯誤，請重新嘗試。" },
  { pattern: /"code"\s*:\s*-32601/, type: "json_rpc", message: "⚠️ 指定的服務方法不存在，請確認設定。" },
  { pattern: /finish_reason\s*:\s*error|finish_reason.*error/i, type: "provider", message: "⚠️ AI 服務暫時無法回應，請稍後再試。" },
  { pattern: /rate_limit/i, type: "provider", message: "⚠️ AI 服務請求過於頻繁，請稍後再試。" },
  { pattern: /context_length_exceeded/i, type: "provider", message: "⚠️ 訊息過長，請縮短後重試。" },
  { pattern: /model_not_found/i, type: "provider", message: "⚠️ AI 模型設定錯誤，請聯繫管理員。" },
  { pattern: /AccessDeniedException/i, type: "acp_permission", message: "🔐 ACP 權限不足，請執行 openclaw acp pair 完成 device pairing。" },
  { pattern: /pairing required/i, type: "acp_permission", message: "🔐 需要完成 device pairing，請參閱安裝指南。" },
  { pattern: /timeout|timed?\s*out/i, type: "timeout", message: "⏱️ Kiro 回應逾時，請稍後再試。" },
];

function formatError(raw: string, exitCode: number): { message: string; type: string } {
  if (exitCode === 3) return { message: "⏱️ Kiro 回應逾時，請稍後再試。", type: "timeout" };
  for (const m of ERROR_MAPPINGS) {
    if (m.pattern.test(raw)) return { message: m.message, type: m.type };
  }
  return { message: "⚠️ Kiro 暫時無法處理您的請求，請稍後再試。", type: "unknown" };
}

// ============================================================
// Provider 錯誤頻率追蹤（需求 15.5）
// ============================================================

const providerErrors = new Map<string, number[]>();

function trackProviderError(chatId: string): boolean {
  const now = Date.now();
  let timestamps = providerErrors.get(chatId) || [];
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < 300_000);
  providerErrors.set(chatId, timestamps);
  return timestamps.length >= 3;
}

// ============================================================
// 工具函式
// ============================================================

function log(msg: string) {
  appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
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
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  const data = (await res.json()) as { ok: boolean };
  if (!data.ok) log(`Telegram send failed: ${JSON.stringify(data)}`);
}

// ============================================================
// Agent 呼叫
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
          resolve({ text: "", exitCode, raw: [stdout, stderr, err.message].filter(Boolean).join("\n") });
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const text = parsed?.result?.payloads?.[0]?.text;
          if (text) { resolve({ text, exitCode: 0, raw: stdout }); return; }
        } catch {}
        resolve({ text: stdout.trim(), exitCode: 0, raw: stdout });
      }
    );
  });
}

// ============================================================
// 核心處理邏輯
// ============================================================

async function handleKiroQuery(chatId: string, query: string, sessionId: string) {
  try {
    log(`Querying agent: ${query} sessionId=${sessionId}`);
    const result = await queryAgent(query, sessionId);

    if (result.exitCode !== 0) {
      const formatted = formatError(result.raw, result.exitCode);
      log(`Error: type=${formatted.type} raw=${result.raw.slice(0, 200)}`);
      let msg = `${REPLY_PREFIX}\n\n${formatted.message}`;
      if (formatted.type === "provider" && trackProviderError(chatId)) {
        msg += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
      }
      await sendTelegram(chatId, msg);
      return;
    }

    if (!result.text) {
      await sendTelegram(chatId, `${REPLY_PREFIX}\n\n⚠️ 收到空白回覆，請稍後再試。`);
      return;
    }

    const formatted = formatError(result.text, 0);
    if (formatted.type === "provider") {
      log(`Provider error in reply: ${result.text.slice(0, 200)}`);
      let msg = `${REPLY_PREFIX}\n\n${formatted.message}`;
      if (trackProviderError(chatId)) {
        msg += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
      }
      await sendTelegram(chatId, msg);
      return;
    }

    log(`Reply: ${result.text.slice(0, 200)}`);
    await sendTelegram(chatId, `${REPLY_PREFIX}\n\n${result.text}`);
  } catch (err: any) {
    log(`Unexpected error: ${err?.message || String(err)}`);
    try {
      await sendTelegram(chatId, `${REPLY_PREFIX}\n\n⚠️ Kiro 暫時無法處理您的請求，請稍後再試。`);
    } catch {}
  }
}

// ============================================================
// Hook Handler
// ============================================================

const handler = (event: any) => {
  if (event?.type === "message" && event?.action === "sending") {
    const sessionKey = String(event?.sessionKey || "");
    if (shouldCancel(sessionKey)) return { cancel: true };
    return;
  }

  if (event?.type !== "message" || event?.action !== "received") return;
  if (event?.context?.channelId !== "telegram") return;

  const content = event?.context?.content;
  const rawId = String(event?.context?.conversationId || event?.context?.from || "");
  const chatId = rawId.replace(/^telegram:/, "");
  const sessionKey = String(event?.sessionKey || "");

  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;
  if (!content || !content.startsWith(COMMAND_PREFIX)) return;
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(chatId)) return;

  markSession(sessionKey);
  const kiroSessionId = getKiroSessionId(chatId);

  const query = content.replace(/^\/kiro\s*/, "").trim();
  if (!query) {
    sendTelegram(chatId, `${REPLY_PREFIX}\n\nUsage: /kiro <你的問題>`);
    return;
  }

  log(`KIRO QUERY: ${query} from chatId=${chatId} session=${kiroSessionId}`);
  void handleKiroQuery(chatId, query, kiroSessionId);
};

export default handler;
