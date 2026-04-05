import dotenv from "dotenv";
import type { SkillConfig } from "../types/index.js";

// Load environment variables from .env file
dotenv.config();

/**
 * Load configuration from environment variables, validate required fields,
 * and return a type-safe configuration object.
 * Throws an error with a clear message when required variables are missing.
 *
 * Requirements: 4.3, 4.4
 */
export function loadConfig(): SkillConfig {
  const env = process.env;

  const kiroAgentName = env.KIRO_AGENT_NAME ?? "kiro";

  const rawTimeout = env.KIRO_TIMEOUT_MS ?? "120000";
  const kiroTimeoutMs = Number(rawTimeout);
  if (Number.isNaN(kiroTimeoutMs) || kiroTimeoutMs <= 0) {
    throw new Error(
      `The value "${rawTimeout}" for environment variable KIRO_TIMEOUT_MS is not a valid positive integer. Please set it to a millisecond value, e.g. 120000.`,
    );
  }

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
    allowedChatIds,
    replyPrefix,
    debugMode,
  };
}
