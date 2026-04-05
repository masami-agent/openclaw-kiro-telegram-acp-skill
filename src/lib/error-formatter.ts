// ============================================================
// Error Formatter — 將原始技術錯誤轉換為使用者友善的訊息
// 對應需求: 11.1, 11.2, 11.3, 11.4, 11.5, 15.1, 15.2, 15.3
// ============================================================

import type { ErrorMapping, ErrorType, FormattedError } from "../types/index.js";

/** 使用者訊息最大長度 */
const MAX_USER_MESSAGE_LENGTH = 200;

/**
 * 錯誤代碼對應表，按優先順序比對。
 * 涵蓋 JSON-RPC errors、provider errors、timeout、ACP permission、unknown。
 */
export const ERROR_MAPPINGS: ErrorMapping[] = [
  // --- JSON-RPC errors ---
  {
    pattern: /"code"\s*:\s*-32603/,
    errorType: "json_rpc",
    userMessage: "⚠️ 服務內部錯誤，請稍後再試。",
  },
  {
    pattern: /"code"\s*:\s*-32600/,
    errorType: "json_rpc",
    userMessage: "⚠️ 請求格式錯誤，請重新嘗試。",
  },
  {
    pattern: /"code"\s*:\s*-32601/,
    errorType: "json_rpc",
    userMessage: "⚠️ 指定的服務方法不存在，請確認設定。",
  },
  // --- Provider errors ---
  {
    pattern: /finish_reason\s*:\s*error|finish_reason.*error/i,
    errorType: "provider",
    userMessage: "⚠️ AI 服務暫時無法回應，請稍後再試。",
  },
  {
    pattern: /rate_limit/i,
    errorType: "provider",
    userMessage: "⚠️ AI 服務請求過於頻繁，請稍後再試。",
  },
  {
    pattern: /context_length_exceeded/i,
    errorType: "provider",
    userMessage: "⚠️ 訊息過長，請縮短後重試。",
  },
  {
    pattern: /model_not_found/i,
    errorType: "provider",
    userMessage: "⚠️ AI 模型設定錯誤，請聯繫管理員。",
  },
  // --- ACP permission errors ---
  {
    pattern: /AccessDeniedException/i,
    errorType: "acp_permission",
    userMessage: "🔐 ACP 權限不足，請執行 device pairing。",
  },
  {
    pattern: /pairing required/i,
    errorType: "acp_permission",
    userMessage: "🔐 需要完成 device pairing，請參閱安裝指南。",
  },
  // --- Timeout (exit code 3 handled in formatError) ---
  {
    pattern: /timeout|timed?\s*out/i,
    errorType: "timeout",
    userMessage: "⏱️ Kiro 回應逾時，請稍後再試。",
  },
];

/** 通用未知錯誤訊息 */
const UNKNOWN_ERROR_MESSAGE = "⚠️ Kiro 暫時無法處理您的請求，請稍後再試。";

/** Timeout 錯誤訊息 */
const TIMEOUT_ERROR_MESSAGE = "⏱️ Kiro 回應逾時，請稍後再試。";

/**
 * 移除敏感資訊：request_id、stack trace、內部端點等。
 */
export function sanitize(message: string): string {
  let result = message;

  // 移除 request_id（各種格式）
  result = result.replace(/["']?request_id["']?\s*[:=]\s*["']?[a-zA-Z0-9\-_]+["']?,?\s*/gi, "");

  // 移除 stack trace（以 "at " 開頭的行）
  result = result.replace(/^\s*at\s+.+$/gm, "");

  // 移除常見 stack trace 標頭
  result = result.replace(/^(Error|TypeError|ReferenceError|SyntaxError|RangeError):.*\n?/gm, "");

  // 移除內部端點 URL（http/https 開頭的 URL）
  result = result.replace(/https?:\/\/[^\s"',)}\]]+/gi, "[redacted-url]");

  // 移除連續空行
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * 確保訊息長度不超過上限，超過時截斷並加上省略號。
 */
function truncateMessage(message: string, maxLength: number = MAX_USER_MESSAGE_LENGTH): string {
  if (message.length <= maxLength) {
    return message;
  }
  return message.slice(0, maxLength - 1) + "…";
}

/**
 * 解析 ACP Wrapper 的 stdout/stderr 輸出，辨識錯誤類型並格式化。
 *
 * @param rawOutput - ACP Wrapper 的原始輸出（stdout + stderr）
 * @param exitCode - ACP Wrapper 的 exit code（0=成功, 1=usage, 2=連線失敗, 3=timeout）
 * @returns FormattedError 包含使用者訊息、除錯訊息與錯誤分類
 */
export function formatError(rawOutput: string, exitCode: number): FormattedError {
  const debugMessage = rawOutput;

  // 優先處理 exit code 3（timeout）
  if (exitCode === 3) {
    return {
      userMessage: truncateMessage(TIMEOUT_ERROR_MESSAGE),
      debugMessage,
      errorType: "timeout",
    };
  }

  // 依序比對錯誤對應表
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(rawOutput)) {
      return {
        userMessage: truncateMessage(mapping.userMessage),
        debugMessage,
        errorType: mapping.errorType,
      };
    }
  }

  // 無法辨識的錯誤 → 通用訊息
  return {
    userMessage: truncateMessage(UNKNOWN_ERROR_MESSAGE),
    debugMessage,
    errorType: "unknown",
  };
}
