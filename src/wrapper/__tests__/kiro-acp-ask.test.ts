import { describe, it, expect, beforeEach } from "vitest";
import type { JsonRpcResponse } from "../../types/index.js";
import {
  buildJsonRpcRequest,
  serializeRequest,
  parseResponses,
  isSessionNotFoundError,
  buildSessionRequests,
  buildFallbackCreateRequest,
  handleSessionResponse,
  extractReplyText,
  parseCLIArgs,
  resetIdCounter,
} from "../kiro-acp-ask.js";

// ============================================================
// JSON-RPC 序列化 / 反序列化
// ============================================================

describe("JSON-RPC helpers", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("buildJsonRpcRequest()", () => {
    it("應建立符合 JSON-RPC 2.0 格式的 request", () => {
      const req = buildJsonRpcRequest("initialize", { foo: "bar" });

      expect(req.jsonrpc).toBe("2.0");
      expect(req.id).toBe(1);
      expect(req.method).toBe("initialize");
      expect(req.params).toEqual({ foo: "bar" });
    });

    it("每次呼叫應遞增 id", () => {
      const r1 = buildJsonRpcRequest("a");
      const r2 = buildJsonRpcRequest("b");
      const r3 = buildJsonRpcRequest("c");

      expect(r1.id).toBe(1);
      expect(r2.id).toBe(2);
      expect(r3.id).toBe(3);
    });

    it("無 params 時不應包含 params 欄位", () => {
      const req = buildJsonRpcRequest("shutdown");

      expect(req).not.toHaveProperty("params");
    });
  });

  describe("serializeRequest()", () => {
    it("應序列化為 JSON 字串並以換行結尾", () => {
      const req = buildJsonRpcRequest("initialize");
      const serialized = serializeRequest(req);

      expect(serialized.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(serialized.trim());
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("initialize");
    });
  });

  describe("parseResponses()", () => {
    it("應從完整的 JSON 行中解析出 response", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: { ok: true },
      };
      const buffer = JSON.stringify(resp) + "\n";

      const [responses, remaining] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
      expect(responses[0]!.id).toBe(1);
      expect(responses[0]!.result).toEqual({ ok: true });
      expect(remaining).toBe("");
    });

    it("應處理多個 response 在同一 buffer 中", () => {
      const r1: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const r2: JsonRpcResponse = { jsonrpc: "2.0", id: 2, result: {} };
      const buffer = JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n";

      const [responses, remaining] = parseResponses(buffer);

      expect(responses).toHaveLength(2);
      expect(responses[0]!.id).toBe(1);
      expect(responses[1]!.id).toBe(2);
      expect(remaining).toBe("");
    });

    it("應保留不完整的行作為 remaining buffer", () => {
      const complete: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const buffer = JSON.stringify(complete) + "\n" + '{"jsonrpc":"2.0","id":2';

      const [responses, remaining] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
      expect(remaining).toBe('{"jsonrpc":"2.0","id":2');
    });

    it("應忽略空行", () => {
      const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const buffer = "\n\n" + JSON.stringify(resp) + "\n\n";

      const [responses] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
    });

    it("應忽略非 JSON-RPC 格式的行", () => {
      const buffer = "some random log output\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\n" +
        "another log line\n";

      const [responses] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
      expect(responses[0]!.id).toBe(1);
    });

    it("空 buffer 應回傳空陣列", () => {
      const [responses, remaining] = parseResponses("");

      expect(responses).toHaveLength(0);
      expect(remaining).toBe("");
    });
  });
});

// ============================================================
// Session not found 偵測
// ============================================================

describe("isSessionNotFoundError()", () => {
  it("error.message 包含 'session not found' 時應回傳 true", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Session not found" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("error.message 包含 'session does not exist' 時應回傳 true", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Session does not exist" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("error.message 包含 'no such session' 時應回傳 true", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "No such session for this agent" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("error.data 包含 'session not found' 時應回傳 true", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Error", data: "session not found in store" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("error.message 包含 'invalid session' 時應回傳 true", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Invalid session ID provided" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("無 error 時應回傳 false", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { sessionId: "abc" },
    };
    expect(isSessionNotFoundError(resp)).toBe(false);
  });

  it("不相關的 error 應回傳 false", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    };
    expect(isSessionNotFoundError(resp)).toBe(false);
  });
});

// ============================================================
// Session 建立與 fallback 邏輯
// ============================================================

describe("Session setup", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("buildSessionRequests()", () => {
    it("有 sessionId 時應建立 bindSession request", () => {
      const [req, method] = buildSessionRequests("kiro", "session-123");

      expect(method).toBe("acp/bindSession");
      expect(req.method).toBe("acp/bindSession");
      expect(req.params).toEqual({
        agentName: "kiro",
        sessionId: "session-123",
      });
    });

    it("無 sessionId 時應建立 createSession request", () => {
      const [req, method] = buildSessionRequests("kiro");

      expect(method).toBe("acp/createSession");
      expect(req.method).toBe("acp/createSession");
      expect(req.params).toEqual({ agentName: "kiro" });
    });

    it("sessionId 為 undefined 時應建立 createSession request", () => {
      const [req, method] = buildSessionRequests("kiro", undefined);

      expect(method).toBe("acp/createSession");
      expect(req.method).toBe("acp/createSession");
    });
  });

  describe("buildFallbackCreateRequest()", () => {
    it("應建立 createSession request", () => {
      const req = buildFallbackCreateRequest("kiro");

      expect(req.method).toBe("acp/createSession");
      expect(req.params).toEqual({ agentName: "kiro" });
    });
  });

  describe("handleSessionResponse()", () => {
    it("成功的 createSession 應回傳 ok + sessionId", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: { sessionId: "new-session-abc" },
      };

      const result = handleSessionResponse(resp, "acp/createSession");

      expect(result).toEqual({
        action: "ok",
        sessionId: "new-session-abc",
      });
    });

    it("成功的 bindSession 應回傳 ok + sessionId", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: { sessionId: "existing-session" },
      };

      const result = handleSessionResponse(resp, "acp/bindSession");

      expect(result).toEqual({
        action: "ok",
        sessionId: "existing-session",
      });
    });

    it("應支援 session_id（snake_case）欄位名稱", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: { session_id: "snake-case-id" },
      };

      const result = handleSessionResponse(resp, "acp/createSession");

      expect(result).toEqual({
        action: "ok",
        sessionId: "snake-case-id",
      });
    });

    it("bindSession 遇到 session not found 應回傳 fallback", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Session not found" },
      };

      const result = handleSessionResponse(resp, "acp/bindSession");

      expect(result).toEqual({ action: "fallback" });
    });

    it("createSession 遇到 session not found 應回傳 error（不 fallback）", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Session not found" },
      };

      const result = handleSessionResponse(resp, "acp/createSession");

      expect(result.action).toBe("error");
    });

    it("bindSession 遇到非 session-not-found 錯誤應回傳 error", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32603, message: "Internal error" },
      };

      const result = handleSessionResponse(resp, "acp/bindSession");

      expect(result.action).toBe("error");
      if (result.action === "error") {
        expect(result.message).toBe("Internal error");
      }
    });

    it("response 缺少 sessionId 應回傳 error", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        result: {},
      };

      const result = handleSessionResponse(resp, "acp/createSession");

      expect(result.action).toBe("error");
      if (result.action === "error") {
        expect(result.message).toContain("sessionId");
      }
    });
  });
});

// ============================================================
// extractReplyText
// ============================================================

describe("extractReplyText()", () => {
  it("應從 result.text 提取回覆文字", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { text: "Hello from Kiro!" },
    };

    expect(extractReplyText(resp)).toBe("Hello from Kiro!");
  });

  it("應從 result.content 提取回覆文字", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: "Content field reply" },
    };

    expect(extractReplyText(resp)).toBe("Content field reply");
  });

  it("應從 result.message 提取回覆文字", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { message: "Message field reply" },
    };

    expect(extractReplyText(resp)).toBe("Message field reply");
  });

  it("result.text 優先於 result.content", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { text: "primary", content: "secondary" },
    };

    expect(extractReplyText(resp)).toBe("primary");
  });

  it("response 有 error 時應拋出錯誤", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Something went wrong" },
    };

    expect(() => extractReplyText(resp)).toThrow("Something went wrong");
  });

  it("result 為空物件時應回傳空字串", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    };

    expect(extractReplyText(resp)).toBe("");
  });
});

// ============================================================
// CLI 參數解析
// ============================================================

describe("parseCLIArgs()", () => {
  it("應正確解析 agent 與 prompt", () => {
    const result = parseCLIArgs(["node", "script.js", "kiro", "hello world"]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello world",
    });
  });

  it("應將多個 prompt 參數合併為一個字串", () => {
    const result = parseCLIArgs([
      "node", "script.js", "kiro", "hello", "beautiful", "world",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello beautiful world",
    });
  });

  it("應解析 --session-id 選項", () => {
    const result = parseCLIArgs([
      "node", "script.js", "kiro", "hello", "--session-id", "sess-123",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello",
      sessionId: "sess-123",
    });
  });

  it("--session-id 在 prompt 之前也應正確解析", () => {
    const result = parseCLIArgs([
      "node", "script.js", "--session-id", "sess-456", "kiro", "hello",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello",
      sessionId: "sess-456",
    });
  });

  it("參數不足時應回傳 null", () => {
    expect(parseCLIArgs(["node", "script.js"])).toBeNull();
    expect(parseCLIArgs(["node", "script.js", "kiro"])).toBeNull();
  });

  it("僅有 --session-id 無 agent/prompt 時應回傳 null", () => {
    expect(
      parseCLIArgs(["node", "script.js", "--session-id", "sess-123"]),
    ).toBeNull();
  });

  it("--session-id 無值時應回傳 null（值被當作 agent）", () => {
    // "--session-id" 後面沒有值，"kiro" 被當作 agent，缺少 prompt
    const result = parseCLIArgs([
      "node", "script.js", "--session-id", "kiro",
    ]);

    expect(result).toBeNull();
  });
});
