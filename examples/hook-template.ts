// ============================================================
// Hook Handler — OpenClaw 事件處理器，整合所有模組進行訊息路由
// 對應需求: 6.1, 6.2, 6.3, 12.1–12.5, 13.1–13.3, 15.4, 15.5
// ============================================================
//
// 為何使用 ACP Wrapper（kiro-acp-ask）而非直接呼叫 `openclaw agent --message` CLI？
//
// 根據 docs/wrapper-contract.md 的說明：
// OpenClaw 2026.4.2 的 `openclaw acp` 是一個 stdio ACP bridge server，
// 而非 HTTP endpoint 或 one-shot CLI 指令。Telegram hook 需要 request/response
// 行為，因此透過一個薄 wrapper（kiro-acp-ask）作為橋接是最乾淨的方式。
//
// Wrapper 的職責：
// 1. 接受 agent 名稱與 prompt 作為命令列參數
// 2. 透過 stdio JSON-RPC 與 `openclaw acp` bridge 通訊
// 3. 僅將最終回覆文字輸出至 stdout
// 4. 失敗時回傳非零 exit code
// 5. 將 debug/error 訊息輸出至 stderr
//
// 使用 `execFile`（而非 `execSync`）避免阻塞 gateway event loop。
// ============================================================
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { loadConfig } from "../lib/config.js";
import { markSession, shouldCancel } from "../lib/reply-suppressor.js";
import { getKiroSessionId } from "../lib/session-isolator.js";
import { formatError } from "../lib/error-formatter.js";
import { handleAcpError } from "../lib/acp-error-handler.js";
// ============================================================
// 設定載入（模組層級，僅載入一次）
// ============================================================
let config;
try {
    config = loadConfig();
}
catch (err) {
    process.stderr.write(`[hook] Failed to load config: ${err.message}\n`);
    // 使用預設值作為 fallback，避免 hook 完全無法載入
    config = {
        kiroAgentName: "kiro",
        kiroTimeoutMs: 120_000,
        kiroWrapperCmd: "kiro-acp-ask",
        allowedChatIds: [],
        replyPrefix: "🤖 Kiro",
        debugMode: false,
    };
}
// ============================================================
// Provider 錯誤頻率追蹤（需求 15.5）
// 同一使用者 5 分鐘內連續 3 次 provider 錯誤時額外提示
// ============================================================
const PROVIDER_ERROR_WINDOW_MS = 5 * 60 * 1000; // 5 分鐘
const PROVIDER_ERROR_THRESHOLD = 3;
/** chatId → 錯誤時間戳記陣列 */
const providerErrorTracker = new Map();
/**
 * 記錄一次 provider 錯誤，並回傳是否已達到頻率閾值。
 */
export function trackProviderError(chatId) {
    const now = Date.now();
    let timestamps = providerErrorTracker.get(chatId);
    if (!timestamps) {
        timestamps = [];
        providerErrorTracker.set(chatId, timestamps);
    }
    timestamps.push(now);
    // 清除超出視窗的舊記錄
    const cutoff = now - PROVIDER_ERROR_WINDOW_MS;
    const filtered = timestamps.filter((t) => t > cutoff);
    providerErrorTracker.set(chatId, filtered);
    return filtered.length >= PROVIDER_ERROR_THRESHOLD;
}
/**
 * 清除指定 chatId 的 provider 錯誤追蹤記錄。
 * 主要供測試使用。
 */
export function clearProviderErrors(chatId) {
    if (chatId) {
        providerErrorTracker.delete(chatId);
    }
    else {
        providerErrorTracker.clear();
    }
}
// ============================================================
// Telegram 訊息傳送
// ============================================================
/**
 * 從 ~/.openclaw/openclaw.json 讀取 bot token。
 * 使用 readFileSync 確保同步取得（避免 race condition）。
 */
function getBotToken() {
    const cfgPath = `${process.env.HOME}/.openclaw/openclaw.json`;
    const raw = readFileSync(cfgPath, "utf8");
    const cfg = JSON.parse(raw);
    return cfg.channels.telegram.botToken;
}
/**
 * 透過 Telegram Bot API 傳送訊息。
 */
async function sendTelegram(chatId, text) {
    const token = getBotToken();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
    });
    const data = (await res.json());
    if (!data.ok) {
        throw new Error(`Telegram send failed: ${JSON.stringify(data)}`);
    }
}
// ============================================================
// ACP Wrapper 呼叫
// ============================================================
/**
 * 透過 execFile 呼叫 ACP Wrapper（kiro-acp-ask），非阻塞。
 *
 * 參見 docs/wrapper-contract.md：
 * - stdout → 回覆文字
 * - stderr → 診斷訊息
 * - exit code 0 → 成功, 1 → usage, 2 → 連線失敗, 3 → timeout
 */
function callAcpWrapper(prompt, sessionId) {
    return new Promise((resolve) => {
        const args = [
            config.kiroAgentName,
            prompt,
            "--session-id",
            sessionId,
        ];
        execFile(config.kiroWrapperCmd, args, {
            timeout: config.kiroTimeoutMs,
            encoding: "utf8",
            env: { ...process.env },
        }, (err, stdout, stderr) => {
            if (err) {
                // execFile error 包含 exit code 資訊
                const exitCode = err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
                    ? 2
                    : typeof err.status === "number"
                        ? err.status
                        : err.code === "ETIMEDOUT" || err.killed
                            ? 3
                            : 2;
                resolve({
                    stdout: stdout ?? "",
                    stderr: stderr ?? err.message,
                    exitCode,
                });
                return;
            }
            resolve({ stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
        });
    });
}
// ============================================================
// 輔助函式
// ============================================================
/**
 * 從 OpenClaw event context 提取 Telegram chat ID。
 * OpenClaw 使用 `conversationId` 並帶有 `telegram:` 前綴。
 */
function extractChatId(event) {
    const raw = String(event?.context?.conversationId ?? event?.context?.from ?? "");
    return raw.replace(/^telegram:/, "");
}
// ============================================================
// 核心處理邏輯
// ============================================================
/**
 * 處理 /kiro 指令：呼叫 ACP Wrapper 並傳送回覆至 Telegram。
 */
async function handleKiroQuery(chatId, query, sessionId) {
    try {
        const result = await callAcpWrapper(query, sessionId);
        if (result.exitCode !== 0) {
            // 錯誤路徑：透過 Error Formatter 處理
            const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
            // 先嘗試 ACP Error Handler（辨識權限類錯誤）
            const acpResult = handleAcpError(combined);
            if (acpResult.isAcpError) {
                const message = `${config.replyPrefix}\n\n${acpResult.userMessage}\n\n${acpResult.fixSuggestions.join("\n")}`;
                await sendTelegram(chatId, message);
                return;
            }
            // 使用通用 Error Formatter
            const formatted = formatError(combined, result.exitCode);
            // 記錄完整錯誤至 stderr（需求 15.4）
            const timestamp = new Date().toISOString();
            const promptSummary = query.slice(0, 50);
            process.stderr.write(`[hook] ${timestamp} Provider/ACP error for chatId=${chatId} prompt="${promptSummary}" raw=${formatted.debugMessage}\n`);
            let userMessage = `${config.replyPrefix}\n\n${formatted.userMessage}`;
            // Provider 錯誤頻率追蹤（需求 15.5）
            if (formatted.errorType === "provider") {
                const exceeded = trackProviderError(chatId);
                if (exceeded) {
                    userMessage += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
                }
            }
            await sendTelegram(chatId, userMessage);
            return;
        }
        // 成功路徑：檢查 stdout 是否包含 provider 錯誤（需求 15.3）
        const stdout = result.stdout.trim();
        if (!stdout) {
            await sendTelegram(chatId, `${config.replyPrefix}\n\n⚠️ 收到空白回覆，請稍後再試。`);
            return;
        }
        // 檢查 stdout 是否混合了 provider 錯誤
        const formatted = formatError(stdout, 0);
        if (formatted.errorType === "provider") {
            const timestamp = new Date().toISOString();
            const promptSummary = query.slice(0, 50);
            process.stderr.write(`[hook] ${timestamp} Provider error in stdout for chatId=${chatId} prompt="${promptSummary}" raw=${stdout}\n`);
            let userMessage = `${config.replyPrefix}\n\n${formatted.userMessage}`;
            const exceeded = trackProviderError(chatId);
            if (exceeded) {
                userMessage += "\n\n如持續發生此問題，請聯繫管理員檢查 AI provider 狀態。";
            }
            await sendTelegram(chatId, userMessage);
            return;
        }
        // 正常回覆
        await sendTelegram(chatId, `${config.replyPrefix}\n\n${stdout}`);
    }
    catch (err) {
        // 最後防線：任何未預期的錯誤
        process.stderr.write(`[hook] Unexpected error handling /kiro query: ${err.message}\n`);
        try {
            await sendTelegram(chatId, `${config.replyPrefix}\n\n⚠️ Kiro 暫時無法處理您的請求，請稍後再試。`);
        }
        catch {
            // 連 Telegram 都無法傳送，只能記錄至 stderr
            process.stderr.write(`[hook] Failed to send error message to Telegram\n`);
        }
    }
}
// ============================================================
// Hook Handler（default export，符合 OpenClaw hook 慣例）
// ============================================================
/**
 * OpenClaw Hook Handler — 處理 message:received 與 message:sending 事件。
 *
 * message:received（void hook）：
 *   驗證 channel、chatId、/kiro prefix → markSession()（同步）
 *   → getKiroSessionId() → execFile 呼叫 ACP Wrapper → Error Formatter → Telegram
 *
 * message:sending（可回傳 { cancel: true }）：
 *   shouldCancel() 檢查是否需取消主 agent 回覆
 */
const handler = (event) => {
    // ── message:sending ─────────────────────────────────────────
    // 取消主 OpenClaw agent 回覆（當 /kiro 指令正在處理時）。
    // 只有 message:sending 支援 { cancel: true } 回傳值。
    if (event?.type === "message" && event?.action === "sending") {
        const sessionKey = String(event?.sessionKey ?? "");
        if (shouldCancel(sessionKey)) {
            return { cancel: true };
        }
        return;
    }
    // ── message:received ────────────────────────────────────────
    if (event?.type !== "message" || event?.action !== "received")
        return;
    if (event?.context?.channelId !== "telegram")
        return;
    const content = event?.context?.content;
    const chatId = extractChatId(event);
    const sessionKey = String(event?.sessionKey ?? "");
    // 僅處理 Telegram direct message session（需求 13.1, 13.2）
    if (!sessionKey.startsWith("agent:main:telegram:direct:"))
        return;
    // 檢查 /kiro 前綴
    if (!content || !content.startsWith("/kiro"))
        return;
    // ALLOWED_CHAT_IDS 過濾（空陣列 = 不限制）
    if (config.allowedChatIds.length > 0 && !config.allowedChatIds.includes(chatId)) {
        return;
    }
    // 同步標記 session（需求 12.3）
    // 必須在任何 async 操作之前完成，確保 message:sending 能偵測到標記
    markSession(sessionKey);
    // 取得固定的 Kiro session ID（需求 13.5）
    // 同一 chatId 永遠對應同一 session，實現跨訊息記憶
    const kiroSessionId = getKiroSessionId(chatId);
    // 解析 prompt
    const query = content.replace(/^\/kiro\s*/, "").trim();
    if (!query) {
        void sendTelegram(chatId, `${config.replyPrefix}\n\nUsage: /kiro <your question>`);
        return;
    }
    // 非同步呼叫 ACP Wrapper（不阻塞 gateway event loop）
    void handleKiroQuery(chatId, query, kiroSessionId);
};
export default handler;
// 匯出內部函式供測試使用
export { extractChatId, handleKiroQuery, callAcpWrapper, sendTelegram, getBotToken, config, providerErrorTracker, PROVIDER_ERROR_WINDOW_MS, PROVIDER_ERROR_THRESHOLD, };
//# sourceMappingURL=handler.js.map