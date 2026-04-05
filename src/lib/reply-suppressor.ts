// ============================================================
// Reply Suppressor — 管理 pending session 標記，確保 message:sending
// hook 能可靠地取消主 agent 回覆
// 對應需求: 12.1, 12.2, 12.3, 12.4, 12.5
// ============================================================

import type { SuppressionLog } from "../types/index.js";

/** TTL 預設 30 秒（毫秒） */
const DEFAULT_TTL_MS = 30_000;

/** 最大日誌保留筆數 */
const MAX_LOG_ENTRIES = 100;

/**
 * 儲存 session key → 標記時間戳記（Date.now()）。
 * 使用 Map 確保 O(1) 查詢與刪除。
 */
const sessionStore: Map<string, number> = new Map();

/** 操作日誌（環形緩衝區，最多保留 MAX_LOG_ENTRIES 筆） */
const logs: SuppressionLog[] = [];

/**
 * 將日誌寫入 stderr 並加入內部日誌陣列。
 */
function addLog(sessionKey: string, action: SuppressionLog["action"]): void {
  const timestamp = Date.now();
  const entry: SuppressionLog = { sessionKey, timestamp, action };

  // 記錄至 stderr（含 session key 與時間戳記）
  process.stderr.write(
    `[ReplySuppressor] ${action} session="${sessionKey}" at=${timestamp}\n`,
  );

  // 維持日誌上限
  if (logs.length >= MAX_LOG_ENTRIES) {
    logs.shift();
  }
  logs.push(entry);
}

/**
 * 清除過期的 session 標記（TTL 已超過 DEFAULT_TTL_MS）。
 */
function purgeExpired(): void {
  const now = Date.now();
  for (const [key, markedAt] of sessionStore) {
    if (now - markedAt >= DEFAULT_TTL_MS) {
      sessionStore.delete(key);
      addLog(key, "expired");
    }
  }
}

/**
 * 標記 session 為 pending（在 message:received 階段呼叫）。
 *
 * 此為同步操作，確保標記在任何 async 操作（如 ACP Wrapper 呼叫）之前完成，
 * 避免 message:sending hook 因時序問題而遺失取消訊號。
 */
export function markSession(sessionKey: string): void {
  purgeExpired();
  sessionStore.set(sessionKey, Date.now());
  addLog(sessionKey, "marked");
}

/**
 * 檢查並消費 session 標記（在 message:sending 階段呼叫）。
 *
 * 回傳 true 表示應取消主 agent 回覆（回傳 `{ cancel: true }`）。
 * 消費後標記會被清除，避免影響後續非 `/kiro` 訊息的正常處理。
 *
 * @returns true 若 session 已標記且未過期，false 否則
 */
export function shouldCancel(sessionKey: string): boolean {
  purgeExpired();

  const markedAt = sessionStore.get(sessionKey);
  if (markedAt === undefined) {
    return false;
  }

  // 檢查是否在 TTL 內
  if (Date.now() - markedAt >= DEFAULT_TTL_MS) {
    sessionStore.delete(sessionKey);
    addLog(sessionKey, "expired");
    return false;
  }

  // 消費標記（一次性使用）
  sessionStore.delete(sessionKey);
  addLog(sessionKey, "cancelled");
  return true;
}

/**
 * 取得最近的抑制操作日誌供除錯使用。
 *
 * @param count - 回傳的日誌筆數，預設 10
 * @returns 最近的 SuppressionLog 陣列（由舊到新）
 */
export function getRecentLogs(count: number = 10): SuppressionLog[] {
  const start = Math.max(0, logs.length - count);
  return logs.slice(start);
}
