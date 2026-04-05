#!/usr/bin/env node
/**
 * ACP Wrapper — 透過 stdio 與 `openclaw acp` bridge 通訊的 ACP 客戶端。
 *
 * 程式化使用：import { acpAsk } from "./kiro-acp-ask.js"
 * CLI 使用：kiro-acp-ask <agent> <prompt> [--session-id <id>]
 *
 * Exit codes:
 *   0 = 成功
 *   1 = usage error
 *   2 = 連線失敗
 *   3 = timeout
 *
 * 所有診斷訊息輸出至 stderr，僅最終回覆文字輸出至 stdout。
 */
import { spawn } from "node:child_process";
// ============================================================
// JSON-RPC helpers（exported for testing）
// ============================================================
let _nextId = 1;
/** 重設 JSON-RPC request ID 計數器（僅供測試使用）。 */
export function resetIdCounter() {
    _nextId = 1;
}
/** 建立 JSON-RPC 2.0 request 物件。 */
export function buildJsonRpcRequest(method, params) {
    const req = {
        jsonrpc: "2.0",
        id: _nextId++,
        method,
    };
    if (params !== undefined) {
        req.params = params;
    }
    return req;
}
/** 將 JSON-RPC request 序列化為可寫入 stdin 的字串（含換行）。 */
export function serializeRequest(req) {
    return JSON.stringify(req) + "\n";
}
/**
 * 從原始 buffer 字串中解析出所有完整的 JSON-RPC response。
 * 回傳 [已解析的 responses, 剩餘未完成的 buffer]。
 */
export function parseResponses(buffer) {
    const responses = [];
    let remaining = buffer;
    while (true) {
        const newlineIdx = remaining.indexOf("\n");
        if (newlineIdx === -1)
            break;
        const line = remaining.slice(0, newlineIdx).trim();
        remaining = remaining.slice(newlineIdx + 1);
        if (line.length === 0)
            continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.jsonrpc === "2.0" && typeof parsed.id === "number") {
                responses.push(parsed);
            }
        }
        catch {
            // 非 JSON 行（可能是 stderr 混入），忽略
        }
    }
    return [responses, remaining];
}
/**
 * 判斷 JSON-RPC response 是否為 session 不存在錯誤。
 * 用於 bindSession fallback 邏輯。
 */
export function isSessionNotFoundError(response) {
    if (!response.error)
        return false;
    const msg = response.error.message?.toLowerCase() ?? "";
    const data = typeof response.error.data === "string"
        ? response.error.data.toLowerCase()
        : "";
    return (msg.includes("session not found") ||
        msg.includes("session does not exist") ||
        msg.includes("no such session") ||
        msg.includes("invalid session") ||
        data.includes("session not found") ||
        data.includes("session does not exist"));
}
/**
 * 產生 session 建立所需的 JSON-RPC request 序列。
 *
 * - 若提供 sessionId → 先嘗試 bindSession
 * - 否則 → 直接 createSession
 *
 * 回傳 [requests, expectedMethod]，其中 expectedMethod 為
 * "acp/bindSession" 或 "acp/createSession"。
 */
export function buildSessionRequests(agentName, sessionId) {
    if (sessionId) {
        const req = buildJsonRpcRequest("acp/bindSession", {
            agentName,
            sessionId,
        });
        return [req, "acp/bindSession"];
    }
    const req = buildJsonRpcRequest("acp/createSession", { agentName });
    return [req, "acp/createSession"];
}
/** 建立 fallback createSession request（bindSession 失敗時使用）。 */
export function buildFallbackCreateRequest(agentName) {
    return buildJsonRpcRequest("acp/createSession", { agentName });
}
/**
 * 處理 session 回應，判斷是否需要 fallback。
 *
 * 回傳：
 * - { action: "ok", sessionId } — session 建立成功
 * - { action: "fallback" } — bindSession 失敗，需 fallback 至 createSession
 * - { action: "error", message } — 不可恢復的錯誤
 */
export function handleSessionResponse(response, method) {
    if (response.error) {
        if (method === "acp/bindSession" && isSessionNotFoundError(response)) {
            return { action: "fallback" };
        }
        return {
            action: "error",
            message: response.error.message ?? "Unknown session error",
        };
    }
    const result = response.result;
    const sessionId = result?.sessionId ?? result?.session_id ?? "";
    if (!sessionId) {
        return { action: "error", message: "Session response missing sessionId" };
    }
    return { action: "ok", sessionId };
}
/**
 * 從 sendMessage response 中提取回覆文字。
 */
export function extractReplyText(response) {
    if (response.error) {
        throw new Error(response.error.message ?? "sendMessage returned an error");
    }
    const result = response.result;
    // 嘗試多種常見欄位名稱
    const text = result?.text ??
        result?.content ??
        result?.message ??
        "";
    return text;
}
// ============================================================
// 核心 acpAsk 函式
// ============================================================
export async function acpAsk(options) {
    const { agentName, prompt, timeoutMs, sessionId } = options;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let child;
    try {
        child = spawn("openclaw", ["acp"], {
            stdio: ["pipe", "pipe", "pipe"],
            signal: controller.signal,
        });
        // 收集 stderr 供診斷
        let stderrBuf = "";
        child.stderr?.on("data", (chunk) => {
            stderrBuf += chunk.toString();
        });
        // 建立 response 收集機制
        let stdoutBuf = "";
        const pendingResolvers = new Map();
        child.stdout?.on("data", (chunk) => {
            stdoutBuf += chunk.toString();
            const [responses, remaining] = parseResponses(stdoutBuf);
            stdoutBuf = remaining;
            for (const resp of responses) {
                const pending = pendingResolvers.get(resp.id);
                if (pending) {
                    pendingResolvers.delete(resp.id);
                    pending.resolve(resp);
                }
            }
        });
        const sendAndWait = (req) => {
            return new Promise((resolve, reject) => {
                pendingResolvers.set(req.id, { resolve, reject });
                const data = serializeRequest(req);
                child.stdin.write(data, (err) => {
                    if (err) {
                        pendingResolvers.delete(req.id);
                        reject(err);
                    }
                });
            });
        };
        // 監聽子程序異常退出
        const exitPromise = new Promise((_, reject) => {
            child.on("error", (err) => {
                reject(new Error(`ACP bridge error: ${err.message}`));
            });
            child.on("close", (code) => {
                if (code !== 0 && code !== null) {
                    reject(new Error(`ACP bridge exited with code ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`));
                }
            });
        });
        const raceWithExit = (p) => Promise.race([p, exitPromise]);
        // Step 1: initialize
        process.stderr.write("[acp-wrapper] Sending initialize...\n");
        const initReq = buildJsonRpcRequest("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "kiro-acp-ask", version: "0.1.0" },
        });
        const initResp = await raceWithExit(sendAndWait(initReq));
        if (initResp.error) {
            throw new Error(`initialize failed: ${initResp.error.message}`);
        }
        process.stderr.write("[acp-wrapper] Initialized.\n");
        // Step 2: create or bind session
        let actualSessionId;
        const [sessionReq, sessionMethod] = buildSessionRequests(agentName, sessionId);
        process.stderr.write(`[acp-wrapper] ${sessionMethod}${sessionId ? ` (sessionId=${sessionId})` : ""}...\n`);
        const sessionResp = await raceWithExit(sendAndWait(sessionReq));
        const sessionResult = handleSessionResponse(sessionResp, sessionMethod);
        if (sessionResult.action === "ok") {
            actualSessionId = sessionResult.sessionId;
        }
        else if (sessionResult.action === "fallback") {
            // bindSession 失敗，fallback 至 createSession
            process.stderr.write("[acp-wrapper] bindSession failed (session not found), falling back to createSession...\n");
            const fallbackReq = buildFallbackCreateRequest(agentName);
            const fallbackResp = await raceWithExit(sendAndWait(fallbackReq));
            const fallbackResult = handleSessionResponse(fallbackResp, "acp/createSession");
            if (fallbackResult.action === "ok") {
                actualSessionId = fallbackResult.sessionId;
            }
            else if (fallbackResult.action === "error") {
                throw new Error(`createSession (fallback) failed: ${fallbackResult.message}`);
            }
            else {
                throw new Error("Unexpected fallback result during createSession");
            }
        }
        else {
            throw new Error(`${sessionMethod} failed: ${sessionResult.message}`);
        }
        process.stderr.write(`[acp-wrapper] Session ready: ${actualSessionId}\n`);
        // Step 3: sendMessage
        process.stderr.write("[acp-wrapper] Sending message...\n");
        const msgReq = buildJsonRpcRequest("acp/sendMessage", {
            sessionId: actualSessionId,
            message: { role: "user", content: prompt },
        });
        const msgResp = await raceWithExit(sendAndWait(msgReq));
        const replyText = extractReplyText(msgResp);
        process.stderr.write("[acp-wrapper] Reply received.\n");
        // Step 4: 嘗試 graceful shutdown（不等待回應）
        try {
            const shutdownReq = buildJsonRpcRequest("shutdown");
            child.stdin?.write(serializeRequest(shutdownReq));
            child.stdin?.end();
        }
        catch {
            // shutdown 失敗不影響結果
        }
        return { text: replyText, sessionId: actualSessionId };
    }
    catch (err) {
        // 區分 timeout vs 其他錯誤
        if (controller.signal.aborted) {
            const timeoutErr = new Error("ACP request timed out");
            timeoutErr.code = "TIMEOUT";
            throw timeoutErr;
        }
        throw err;
    }
    finally {
        clearTimeout(timer);
        // 確保子程序被清理
        if (child && !child.killed) {
            try {
                child.kill("SIGTERM");
            }
            catch {
                // ignore
            }
        }
    }
}
// ============================================================
// CLI entry point
// ============================================================
/** 解析 CLI 參數。 */
export function parseCLIArgs(argv) {
    // argv[0] = node, argv[1] = script path
    const args = argv.slice(2);
    if (args.length < 2)
        return null;
    let sessionId;
    const positional = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--session-id" && i + 1 < args.length) {
            sessionId = args[++i];
        }
        else {
            positional.push(args[i]);
        }
    }
    if (positional.length < 2)
        return null;
    const agentName = positional[0];
    const prompt = positional.slice(1).join(" ").trim();
    if (!agentName || !prompt)
        return null;
    return { agentName, prompt, sessionId };
}
/** CLI main — 僅在直接執行時運行。 */
async function main() {
    const parsed = parseCLIArgs(process.argv);
    if (!parsed) {
        process.stderr.write("Usage: kiro-acp-ask <agent> <prompt> [--session-id <id>]\n");
        process.exit(1);
    }
    const { agentName, prompt, sessionId } = parsed;
    const timeoutMs = parseInt(process.env.KIRO_TIMEOUT_MS ?? "120000", 10);
    try {
        const result = await acpAsk({ agentName, prompt, timeoutMs, sessionId });
        // 僅將最終回覆文字輸出至 stdout
        process.stdout.write(result.text);
    }
    catch (err) {
        const error = err;
        if (error.code === "TIMEOUT") {
            process.stderr.write(`[acp-wrapper] Timeout after ${timeoutMs}ms\n`);
            process.exit(3);
        }
        // 連線失敗或其他錯誤
        process.stderr.write(`[acp-wrapper] Error: ${error.message ?? String(err)}\n`);
        process.exit(2);
    }
}
// 偵測是否為直接執行（ESM 環境）
const isDirectRun = process.argv[1] &&
    (process.argv[1].endsWith("kiro-acp-ask.js") ||
        process.argv[1].endsWith("kiro-acp-ask.ts"));
if (isDirectRun) {
    main();
}
//# sourceMappingURL=kiro-acp-ask.js.map