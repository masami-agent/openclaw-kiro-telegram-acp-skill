import { readFileSync } from "fs";
import { execFile } from "child_process";

const COMMAND_PREFIX = "/kiro";
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
 * Query agent via `openclaw agent --message --json` (async, non-blocking).
 *
 * Returns the assistant reply text from the JSON response.
 * Uses a fixed session ID per chat for cross-message memory.
 */
function queryAgent(prompt: string, sessionId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "openclaw",
      ["agent", "--session-id", sessionId, "--message", prompt, "--json"],
      { timeout: AGENT_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.slice(0, 200) || err.message));
          return;
        }
        try {
          const parsed = JSON.parse(stdout);
          const text = parsed?.result?.payloads?.[0]?.text;
          if (text) { resolve(text); return; }
        } catch {}
        const text = stdout.trim();
        if (text) resolve(text);
        else reject(new Error(stderr?.slice(0, 200) || "Empty response from agent"));
      }
    );
  });
}

function getKiroSessionId(chatId: string): string {
  return `kiro-telegram-${chatId}`;
}

async function handleKiroQuery(chatId: string, query: string) {
  try {
    const sessionId = getKiroSessionId(chatId);
    const reply = await queryAgent(query, sessionId);
    await sendTelegram(chatId, `🤖 Kiro\n\n${reply}`);
  } catch (err: any) {
    await sendTelegram(chatId, `🤖 Kiro\n\n⚠️ Error: ${err?.message || String(err)}`);
  }
}

/**
 * Extract the numeric chat ID from OpenClaw event context.
 * OpenClaw uses `conversationId` with a `telegram:` prefix.
 */
function extractChatId(event: any): string {
  const raw = String(event?.context?.conversationId || event?.context?.from || "");
  return raw.replace(/^telegram:/, "");
}

const handler = (event: any) => {
  // ── message:sending ─────────────────────────────────────────────
  // Cancel the main OpenClaw agent reply when a /kiro command is pending.
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
