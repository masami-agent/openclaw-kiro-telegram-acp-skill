import { readFileSync } from "fs";

const ACP_URL = process.env.ACP_BRIDGE_URL || "http://127.0.0.1:7800";
const COMMAND_PREFIX = "/kiro";
const TARGET_AGENT = process.env.KIRO_AGENT || "kiro";
const ALLOWED_CHAT_IDS = (process.env.ALLOWED_CHAT_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function getBotToken(): string {
  const cfg = JSON.parse(
    readFileSync(process.env.HOME + "/.openclaw/openclaw.json", "utf8")
  );
  return cfg.channels.telegram.botToken;
}

async function sendTelegram(chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${getBotToken()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram send failed: ${JSON.stringify(data)}`);
}

async function queryKiro(prompt: string): Promise<string> {
  const res = await fetch(`${ACP_URL}/agents/${TARGET_AGENT}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
    signal: AbortSignal.timeout(300000),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data.text || data.response || "(no response from Kiro)";
}

async function handleKiroQuery(chatId: string, query: string) {
  try {
    const reply = await queryKiro(query);
    await sendTelegram(chatId, `🤖 Kiro\n\n${reply}`);
  } catch (err: any) {
    await sendTelegram(chatId, `🤖 Kiro\n\n⚠️ Error: ${err?.message || String(err)}`);
  }
}

const handler = (event: any) => {
  if (event?.type !== "message" || event?.action !== "received") return;
  if (event?.context?.channelId !== "telegram") return;

  const content = event?.context?.content;
  const chatId = String(event?.context?.chatId || "");
  const sessionKey = String(event?.sessionKey || "");

  if (!sessionKey.startsWith("agent:main:telegram:direct:")) return;
  if (!content || !content.startsWith(COMMAND_PREFIX)) return;
  if (ALLOWED_CHAT_IDS.length && !ALLOWED_CHAT_IDS.includes(chatId)) return { suppress: true };

  const query = content.replace(/^\/kiro\s*/, "").trim();
  if (!query) {
    sendTelegram(chatId, "Usage: /kiro <your question>");
    return { suppress: true };
  }

  void handleKiroQuery(chatId, query);
  return { suppress: true };
};

export default handler;
