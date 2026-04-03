import { readFileSync } from "fs";
import { spawn } from "child_process";

const COMMAND_PREFIX = "/kiro";
const TARGET_AGENT = process.env.KIRO_AGENT || "kiro";
const ACP_TIMEOUT_MS = Number(process.env.KIRO_TIMEOUT_MS || 300000);
const ACP_WRAPPER_COMMAND = process.env.KIRO_ACP_WRAPPER || "kiro-acp-ask";
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

function queryKiro(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ACP_WRAPPER_COMMAND, [TARGET_AGENT, prompt], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`ACP request timed out after ${ACP_TIMEOUT_MS}ms`));
    }, ACP_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const out = stdout.trim();
      const err = stderr.trim();

      if (code !== 0) {
        reject(new Error(err || `${ACP_WRAPPER_COMMAND} exited with code ${code}`));
        return;
      }

      if (!out) {
        reject(new Error(err || "No response from Kiro"));
        return;
      }

      resolve(out);
    });
  });
}

function formatKiroError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (/pairing required/i.test(message)) {
    return [
      "⚠️ ACP pairing is required.",
      "Approve the latest device request, then try again:",
      "openclaw devices approve --latest",
    ].join("\n");
  }

  if (/not found|enoent/i.test(message)) {
    return [
      "⚠️ ACP wrapper command not found.",
      `Expected wrapper: ${ACP_WRAPPER_COMMAND}`,
      "Provide a local ACP client or wrapper that talks to `openclaw acp` over stdio.",
    ].join("\n");
  }

  return `⚠️ Error: ${message}`;
}

async function handleKiroQuery(chatId: string, query: string) {
  try {
    const reply = await queryKiro(query);
    await sendTelegram(chatId, `🤖 Kiro\n\n${reply}`);
  } catch (err) {
    await sendTelegram(chatId, `🤖 Kiro\n\n${formatKiroError(err)}`);
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
    void sendTelegram(chatId, "Usage: /kiro <your question>");
    return { suppress: true };
  }

  void handleKiroQuery(chatId, query);
  return { suppress: true };
};

export default handler;
