import { describe, it, expect } from "vitest";
import { formatError, sanitize, ERROR_MAPPINGS } from "../error-formatter.js";

describe("formatError()", () => {
  // --- JSON-RPC errors ---
  it("應辨識 JSON-RPC -32603 (Internal error) 並回傳對應訊息", () => {
    const raw = '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"something"}}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ 服務內部錯誤，請稍後再試。");
    expect(result.debugMessage).toBe(raw);
  });

  it("應辨識 JSON-RPC -32600 (Invalid Request) 並回傳對應訊息", () => {
    const raw = '{"code":-32600,"message":"Invalid Request"}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ 請求格式錯誤，請重新嘗試。");
  });

  it("應辨識 JSON-RPC -32601 (Method not found) 並回傳對應訊息", () => {
    const raw = '{"code":-32601,"message":"Method not found"}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ 指定的服務方法不存在，請確認設定。");
  });

  // --- Provider errors ---
  it("應辨識 finish_reason: error 並回傳 provider 錯誤訊息", () => {
    const raw = 'Provider finish_reason: error - something went wrong';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ AI 服務暫時無法回應，請稍後再試。");
  });

  it("應辨識 rate_limit 並回傳對應訊息", () => {
    const raw = 'Error: rate_limit exceeded, please retry later';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ AI 服務請求過於頻繁，請稍後再試。");
  });

  it("應辨識 context_length_exceeded 並回傳對應訊息", () => {
    const raw = 'Error: context_length_exceeded';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ 訊息過長，請縮短後重試。");
  });

  it("應辨識 model_not_found 並回傳對應訊息", () => {
    const raw = 'Error: model_not_found: gpt-5-turbo';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ AI 模型設定錯誤，請聯繫管理員。");
  });

  // --- ACP permission errors ---
  it("應辨識 AccessDeniedException 並回傳 acp_permission 錯誤", () => {
    const raw = 'AccessDeniedException: User is not authorized';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("acp_permission");
    expect(result.userMessage).toBe("🔐 ACP 權限不足，請執行 device pairing。");
  });

  it("應辨識 pairing required 並回傳 acp_permission 錯誤", () => {
    const raw = 'Error: pairing required for this device';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("acp_permission");
    expect(result.userMessage).toBe("🔐 需要完成 device pairing，請參閱安裝指南。");
  });

  // --- Timeout ---
  it("exit code 3 應回傳 timeout 錯誤（優先於 pattern 比對）", () => {
    const raw = "some random output without timeout keyword";
    const result = formatError(raw, 3);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro 回應逾時，請稍後再試。");
  });

  it("即使 rawOutput 包含其他錯誤模式，exit code 3 仍應回傳 timeout", () => {
    const raw = '{"code":-32603,"message":"Internal error"}';
    const result = formatError(raw, 3);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro 回應逾時，請稍後再試。");
  });

  it("rawOutput 包含 timeout 關鍵字時應回傳 timeout 錯誤", () => {
    const raw = "Connection timed out after 120000ms";
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro 回應逾時，請稍後再試。");
  });

  // --- Unknown errors ---
  it("無法辨識的錯誤應回傳通用訊息", () => {
    const raw = "Something completely unexpected happened";
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("unknown");
    expect(result.userMessage).toBe("⚠️ Kiro 暫時無法處理您的請求，請稍後再試。");
  });

  // --- Message length ---
  it("所有 ERROR_MAPPINGS 的 userMessage 長度應 ≤ 200 字元", () => {
    for (const mapping of ERROR_MAPPINGS) {
      expect(mapping.userMessage.length).toBeLessThanOrEqual(200);
    }
  });

  it("formatError 回傳的 userMessage 長度應 ≤ 200 字元", () => {
    // 測試各種 exit code
    for (const exitCode of [0, 1, 2, 3]) {
      const result = formatError("any error", exitCode);
      expect(result.userMessage.length).toBeLessThanOrEqual(200);
    }
  });

  // --- debugMessage 保留原始輸出 ---
  it("debugMessage 應保留完整的原始輸出", () => {
    const raw = '{"code":-32603,"message":"Internal error","data":"secret-data","request_id":"abc-123"}';
    const result = formatError(raw, 1);

    expect(result.debugMessage).toBe(raw);
  });
});

describe("sanitize()", () => {
  it("應移除 request_id 欄位", () => {
    const input = 'Error occurred. request_id: abc-123-def, details: something';
    const result = sanitize(input);

    expect(result).not.toContain("request_id");
    expect(result).not.toContain("abc-123-def");
  });

  it("應移除 JSON 格式的 request_id", () => {
    const input = '{"error":"bad","request_id":"req-456","code":500}';
    const result = sanitize(input);

    expect(result).not.toContain("request_id");
    expect(result).not.toContain("req-456");
  });

  it("應移除 stack trace 行", () => {
    const input = `Error: something failed
    at Object.<anonymous> (/app/src/index.ts:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1234:14)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;
    const result = sanitize(input);

    expect(result).not.toContain("at Object.<anonymous>");
    expect(result).not.toContain("at Module._compile");
    expect(result).not.toContain("at processTicksAndRejections");
  });

  it("應移除內部端點 URL", () => {
    const input = "Failed to connect to https://internal-api.example.com/v1/chat endpoint";
    const result = sanitize(input);

    expect(result).not.toContain("https://internal-api.example.com/v1/chat");
    expect(result).toContain("[redacted-url]");
  });

  it("應移除 http URL", () => {
    const input = "Connecting to http://localhost:3000/api/health";
    const result = sanitize(input);

    expect(result).not.toContain("http://localhost:3000/api/health");
    expect(result).toContain("[redacted-url]");
  });

  it("應移除常見 Error 類型標頭", () => {
    const input = `TypeError: Cannot read property 'foo' of undefined
    at bar (/app/src/bar.ts:5:3)`;
    const result = sanitize(input);

    expect(result).not.toContain("TypeError:");
    expect(result).not.toContain("at bar");
  });

  it("不含敏感資訊的訊息應保持不變", () => {
    const input = "一般錯誤訊息，沒有敏感資訊";
    const result = sanitize(input);

    expect(result).toBe(input);
  });

  it("應清理多餘的空行", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    const result = sanitize(input);

    expect(result).not.toMatch(/\n{3,}/);
  });
});
