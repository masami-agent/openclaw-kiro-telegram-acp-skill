import dotenv from "dotenv";
import type { SkillConfig } from "../types/index.js";

// 載入 .env 檔案中的環境變數
dotenv.config();

/**
 * 從環境變數載入設定，驗證必要欄位，回傳型別安全的設定物件。
 * 缺少必要變數時拋出含明確訊息的錯誤。
 *
 * 對應需求: 4.3, 4.4
 */
export function loadConfig(): SkillConfig {
  const env = process.env;

  const kiroAgentName = env.KIRO_AGENT_NAME ?? "kiro";

  const rawTimeout = env.KIRO_TIMEOUT_MS ?? "120000";
  const kiroTimeoutMs = Number(rawTimeout);
  if (Number.isNaN(kiroTimeoutMs) || kiroTimeoutMs <= 0) {
    throw new Error(
      `環境變數 KIRO_TIMEOUT_MS 的值 "${rawTimeout}" 不是有效的正整數。請設定為毫秒數，例如 120000。`,
    );
  }

  const kiroWrapperCmd = env.KIRO_WRAPPER_CMD ?? "kiro-acp-ask";

  const rawChatIds = env.ALLOWED_CHAT_IDS ?? "";
  const allowedChatIds = rawChatIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const replyPrefix = env.KIRO_REPLY_PREFIX ?? "🤖 Kiro";

  const rawDebug = env.KIRO_DEBUG ?? "false";
  const debugMode = rawDebug === "true" || rawDebug === "1";

  return {
    kiroAgentName,
    kiroTimeoutMs,
    kiroWrapperCmd,
    allowedChatIds,
    replyPrefix,
    debugMode,
  };
}
