// ============================================================
// Session Isolator — 確保 /kiro 訊息不洩漏至主 agent 的對話 context，
// 並為每個 Telegram 使用者維護固定的 Kiro session ID 以實現跨訊息記憶
// 對應需求: 13.1, 13.2, 13.5
// ============================================================

/** Session ID 前綴，與主 agent 的 session key 命名空間完全分離 */
const SESSION_PREFIX = "kiro-telegram-";

/**
 * 根據 Telegram chat ID 產生固定的 Kiro session ID。
 *
 * 同一個 chat ID 永遠對應同一個 session，讓 kiro-cli 能記住對話歷史。
 * 格式：`kiro-telegram-{chatId}`
 *
 * 此命名空間與 OpenClaw 主 agent 的 session key
 * （`agent:main:telegram:direct:{chatId}`）完全不同，不會互相干擾。
 *
 * @param chatId - Telegram chat ID
 * @returns 固定格式的 Kiro session ID
 */
export function getKiroSessionId(chatId: string): string {
  return `${SESSION_PREFIX}${chatId}`;
}

/**
 * 記錄 OpenClaw hook 機制對 session 隔離的已知限制。
 *
 * 這些限制源自 OpenClaw 平台的 hook 架構設計，無法在 skill 層級完全解決，
 * 但已在 INSTALL.md 中記錄並提供替代方案。
 *
 * @returns 已知限制的字串陣列
 */
export function getIsolationLimitations(): string[] {
  return [
    "OpenClaw 的 message:received hook 無法阻止訊息進入主 agent 的 context window，" +
      "/kiro 訊息內容可能仍會被主 agent 看到。",
    "建議在 SOUL.md 中加入指令，要求主 agent 忽略以 /kiro 開頭的訊息，" +
      "作為 hook 層級隔離的補充方案。",
    "kiro-cli 重啟後 session 可能消失，ACP Wrapper 需處理 session 不存在的情況" +
      "（自動透過 acp/createSession 重建）。",
    "不同 Telegram chat 之間的 Kiro session 是獨立的，但同一 chat 內的所有 /kiro " +
      "訊息共享同一個 session（by design，用於跨訊息記憶）。",
  ];
}
