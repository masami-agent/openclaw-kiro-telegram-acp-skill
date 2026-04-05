// ============================================================
// ACP Error Handler — 處理 ACP 層級的權限與連線錯誤
// 對應需求: 14.1, 14.2, 14.3, 14.4, 14.5
// ============================================================

import type { AcpErrorResult } from "../types/index.js";

/**
 * 辨識 ACP 權限相關錯誤並產生修復建議。
 *
 * 處理順序：
 * 1. AccessDeniedException → 建議執行 `openclaw acp pair`
 * 2. pairing required → 建議檢查 pairing 狀態
 * 3. scope 相關關鍵字 → 建議檢查 scope 權限
 * 4. 無法辨識 → 通用 ACP 錯誤訊息，建議執行 `npm run validate`
 *
 * 所有情況皆將完整原始錯誤記錄至 stderr。
 *
 * @param rawError - ACP Wrapper 回傳的原始錯誤訊息
 * @returns AcpErrorResult 包含辨識結果、使用者訊息與修復建議
 */
export function handleAcpError(rawError: string): AcpErrorResult {
  // 完整原始錯誤記錄至 stderr
  process.stderr.write(`[ACP Error] Raw error: ${rawError}\n`);

  // 1. AccessDeniedException
  if (/AccessDeniedException/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 ACP 權限不足，請執行 device pairing。",
      fixSuggestions: [
        "請執行 `openclaw acp pair` 完成 device pairing",
        "完成後請確認已核准所需的 scope 權限",
      ],
      debugMessage: rawError,
    };
  }

  // 2. pairing required
  if (/pairing\s+required/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 需要完成 device pairing，請參閱安裝指南。",
      fixSuggestions: [
        "請檢查 device pairing 狀態：`openclaw acp status`",
        "若尚未 pairing，請執行 `openclaw acp pair`",
        "詳細步驟請參閱 INSTALL.md 的 ACP Device Pairing 章節",
      ],
      debugMessage: rawError,
    };
  }

  // 3. scope 相關關鍵字
  if (/\bscope\b/i.test(rawError)) {
    return {
      isAcpError: true,
      userMessage: "🔐 ACP scope 權限不足，請確認已核准所需權限。",
      fixSuggestions: [
        "請確認已核准所需的 scope 權限",
        "可執行 `openclaw acp status` 查看目前已核准的 scopes",
        "若需新增 scope，請重新執行 `openclaw acp pair`",
      ],
      debugMessage: rawError,
    };
  }

  // 4. 無法辨識 → 通用 ACP 錯誤
  return {
    isAcpError: false,
    userMessage: "⚠️ ACP 發生未預期的錯誤，請執行 `npm run validate` 進行健康檢查。",
    fixSuggestions: [
      "請執行 `npm run validate` 進行健康檢查",
      "若問題持續，請檢查 `openclaw acp` 是否正常運作",
    ],
    debugMessage: rawError,
  };
}
