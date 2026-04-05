import { readFileSync } from "fs";
import { execFile } from "child_process";

const COMMAND_PREFIX = "/kiro";
const WRAPPER_CMD = process.env.KIRO_WRAPPER_CMD || "kiro-acp-ask";
const AGENT_NAME = process.env.KIRO_AGENT_NAME || "kiro_default";
const AGENT_TIMEOUT_MS = Number(process.env.KIRO_TIMEOUT_MS || 120000);
const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Track sessions with pending /kiro commands for message:sending cancellation
const pendingKiroSessions = new Set<string>();

let cachedBotToken: string | undefined;

function getBotToken(): string {
  if (cachedBotToken) return cachedBotToken;
  const cfg = JSON.parse(
    readFileSync(process.env.HOME + "/.openclaw/openclaw.json", "utf8")
  );
  cachedBotToken = cfg.channels.telegram.botToken;
  return cachedBotToken!;
}

async function sendTelegram(chatId: string, text: string) {
  const res = await fetch(
    `https://api.telegram.org/bot${getBotToken()}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    }
  );
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram send failed: ${JSON.stringify(data)}`);
}

/**
 * Query Kiro via the local ACP wrapper command (async, non-blocking).
 *
 * The wrapper (default: `kiro-acp-ask`) speaks ACP over stdio to
 * `openclaw acp` and returns the final assistant text on stdout.
 * See docs/wrapper-contract.md for the expected contract.
 */
function queryKiro(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      WRAPPER_CMD,
      [AGENT_NAME, prompt],
      { timeout: AGENT_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.slice(0, 200) || err.message));
          return;
        }
        const text = stdout.trim();
        if (text) resolve(text);
        else reject(new Error(stderr?.slice(0, 200) || "Empty response from Kiro"));
      }
    );
  });
}

async function handleKiroQuery(chatId: string, query: string) {
  try {
    const reply = await queryKiro(query);
    await sendTelegram(chatId, `🤖 Kiro\n\n${reply}`);
  } catch (err: any) {
    await sendTelegram(chatId, `🤖 Kiro\n\n⚠️ Error: ${err?.message || String(err)}`);
  }
}

/**
 * Extract the numeric chat ID from OpenClaw event context.
 * OpenClaw 2026.4.2 uses `conversationId` (not `chatId`) with a `telegram:` prefix.
 */
function extractChatId(event: any): string {
  const raw = String(event?.context?.conversationId || event?.context?.from || "");
  return raw.replace(/^telegram:/, "");
}

const handler = (event: any) => {
  // ── message:sending ─────────────────────────────────────────────
  // Cancel the main OpenClaw agent reply when a /kiro command is pending.
  //
  // IMPORTANT: message:received is a void hook — its return value is discarded.
  // Only message:sending supports { cancel: true } to block outgoing replies.
  if (event?.type === "message" && event?.action === "sending") {
    const sessionKey = String(event?.sessionKey || "");
    if (pendingKiroSessions.has(sessionKey)) {
      pendingKiroSessions.delete(sessionKey);
      return { cancel: true };
    }
    return;
  }

  // ── message:received ────────────────────────────────────────────
  if (event?.type !== "message" || event?.action !== "received") return;
  if (event?.context?.channelId !== "telegram") return;

  const content = event?.context?.content;
  const chatId = extractChatId(event);
  const sessionKey = String(event?.sessionKey || "");

  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;
  if (!content || !content.startsWith(COMMAND_PREFIX)) return;
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(chatId)) return;

  // Mark this session so message:sending can cancel the main agent reply
  pendingKiroSessions.add(sessionKey);

  const query = content.replace(/^\/kiro\s*/, "").trim();
  if (!query) {
    void sendTelegram(chatId, "🤖 Kiro\n\nUsage: /kiro <your question>");
    return;
  }

  void handleKiroQuery(chatId, query);
};

export default handler;
