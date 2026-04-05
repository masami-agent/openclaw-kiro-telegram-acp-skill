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
// JSON-RPC serialization / deserialization
// ============================================================

describe("JSON-RPC helpers", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("buildJsonRpcRequest()", () => {
    it("should build a request conforming to JSON-RPC 2.0 format", () => {
      const req = buildJsonRpcRequest("initialize", { foo: "bar" });

      expect(req.jsonrpc).toBe("2.0");
      expect(req.id).toBe(1);
      expect(req.method).toBe("initialize");
      expect(req.params).toEqual({ foo: "bar" });
    });

    it("should increment id on each call", () => {
      const r1 = buildJsonRpcRequest("a");
      const r2 = buildJsonRpcRequest("b");
      const r3 = buildJsonRpcRequest("c");

      expect(r1.id).toBe(1);
      expect(r2.id).toBe(2);
      expect(r3.id).toBe(3);
    });

    it("should not include params field when no params are provided", () => {
      const req = buildJsonRpcRequest("shutdown");

      expect(req).not.toHaveProperty("params");
    });
  });

  describe("serializeRequest()", () => {
    it("should serialize to a JSON string ending with a newline", () => {
      const req = buildJsonRpcRequest("initialize");
      const serialized = serializeRequest(req);

      expect(serialized.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(serialized.trim());
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.method).toBe("initialize");
    });
  });

  describe("parseResponses()", () => {
    it("should parse responses from complete JSON lines", () => {
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

    it("should handle multiple responses in the same buffer", () => {
      const r1: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const r2: JsonRpcResponse = { jsonrpc: "2.0", id: 2, result: {} };
      const buffer = JSON.stringify(r1) + "\n" + JSON.stringify(r2) + "\n";

      const [responses, remaining] = parseResponses(buffer);

      expect(responses).toHaveLength(2);
      expect(responses[0]!.id).toBe(1);
      expect(responses[1]!.id).toBe(2);
      expect(remaining).toBe("");
    });

    it("should preserve incomplete lines as remaining buffer", () => {
      const complete: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const buffer = JSON.stringify(complete) + "\n" + '{"jsonrpc":"2.0","id":2';

      const [responses, remaining] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
      expect(remaining).toBe('{"jsonrpc":"2.0","id":2');
    });

    it("should ignore empty lines", () => {
      const resp: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
      const buffer = "\n\n" + JSON.stringify(resp) + "\n\n";

      const [responses] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
    });

    it("should ignore non-JSON-RPC format lines", () => {
      const buffer = "some random log output\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }) + "\n" +
        "another log line\n";

      const [responses] = parseResponses(buffer);

      expect(responses).toHaveLength(1);
      expect(responses[0]!.id).toBe(1);
    });

    it("empty buffer should return an empty array", () => {
      const [responses, remaining] = parseResponses("");

      expect(responses).toHaveLength(0);
      expect(remaining).toBe("");
    });
  });
});

// ============================================================
// Session not found detection
// ============================================================

describe("isSessionNotFoundError()", () => {
  it("should return true when error.message contains 'session not found'", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Session not found" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("should return true when error.message contains 'session does not exist'", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Session does not exist" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("should return true when error.message contains 'no such session'", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "No such session for this agent" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("should return true when error.data contains 'session not found'", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Error", data: "session not found in store" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("should return true when error.message contains 'invalid session'", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Invalid session ID provided" },
    };
    expect(isSessionNotFoundError(resp)).toBe(true);
  });

  it("should return false when there is no error", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { sessionId: "abc" },
    };
    expect(isSessionNotFoundError(resp)).toBe(false);
  });

  it("should return false for unrelated errors", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32603, message: "Internal error" },
    };
    expect(isSessionNotFoundError(resp)).toBe(false);
  });
});

// ============================================================
// Session setup and fallback logic
// ============================================================

describe("Session setup", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe("buildSessionRequests()", () => {
    it("should build a bindSession request when sessionId is provided", () => {
      const [req, method] = buildSessionRequests("kiro", "session-123");

      expect(method).toBe("acp/bindSession");
      expect(req.method).toBe("acp/bindSession");
      expect(req.params).toEqual({
        agentName: "kiro",
        sessionId: "session-123",
      });
    });

    it("should build a createSession request when no sessionId is provided", () => {
      const [req, method] = buildSessionRequests("kiro");

      expect(method).toBe("acp/createSession");
      expect(req.method).toBe("acp/createSession");
      expect(req.params).toEqual({ agentName: "kiro" });
    });

    it("should build a createSession request when sessionId is undefined", () => {
      const [req, method] = buildSessionRequests("kiro", undefined);

      expect(method).toBe("acp/createSession");
      expect(req.method).toBe("acp/createSession");
    });
  });

  describe("buildFallbackCreateRequest()", () => {
    it("should build a createSession request", () => {
      const req = buildFallbackCreateRequest("kiro");

      expect(req.method).toBe("acp/createSession");
      expect(req.params).toEqual({ agentName: "kiro" });
    });
  });

  describe("handleSessionResponse()", () => {
    it("successful createSession should return ok + sessionId", () => {
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

    it("successful bindSession should return ok + sessionId", () => {
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

    it("should support session_id (snake_case) field name", () => {
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

    it("bindSession encountering session not found should return fallback", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Session not found" },
      };

      const result = handleSessionResponse(resp, "acp/bindSession");

      expect(result).toEqual({ action: "fallback" });
    });

    it("createSession encountering session not found should return error (no fallback)", () => {
      const resp: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32000, message: "Session not found" },
      };

      const result = handleSessionResponse(resp, "acp/createSession");

      expect(result.action).toBe("error");
    });

    it("bindSession encountering non-session-not-found error should return error", () => {
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

    it("response missing sessionId should return error", () => {
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
  it("should extract reply text from result.text", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { text: "Hello from Kiro!" },
    };

    expect(extractReplyText(resp)).toBe("Hello from Kiro!");
  });

  it("should extract reply text from result.content", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { content: "Content field reply" },
    };

    expect(extractReplyText(resp)).toBe("Content field reply");
  });

  it("should extract reply text from result.message", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { message: "Message field reply" },
    };

    expect(extractReplyText(resp)).toBe("Message field reply");
  });

  it("result.text should take priority over result.content", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: { text: "primary", content: "secondary" },
    };

    expect(extractReplyText(resp)).toBe("primary");
  });

  it("should throw an error when response has an error", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "Something went wrong" },
    };

    expect(() => extractReplyText(resp)).toThrow("Something went wrong");
  });

  it("should return an empty string when result is an empty object", () => {
    const resp: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    };

    expect(extractReplyText(resp)).toBe("");
  });
});

// ============================================================
// CLI argument parsing
// ============================================================

describe("parseCLIArgs()", () => {
  it("should correctly parse agent and prompt", () => {
    const result = parseCLIArgs(["node", "script.js", "kiro", "hello world"]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello world",
    });
  });

  it("should merge multiple prompt arguments into a single string", () => {
    const result = parseCLIArgs([
      "node", "script.js", "kiro", "hello", "beautiful", "world",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello beautiful world",
    });
  });

  it("should parse the --session-id option", () => {
    const result = parseCLIArgs([
      "node", "script.js", "kiro", "hello", "--session-id", "sess-123",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello",
      sessionId: "sess-123",
    });
  });

  it("--session-id before prompt should also be parsed correctly", () => {
    const result = parseCLIArgs([
      "node", "script.js", "--session-id", "sess-456", "kiro", "hello",
    ]);

    expect(result).toEqual({
      agentName: "kiro",
      prompt: "hello",
      sessionId: "sess-456",
    });
  });

  it("should return null when arguments are insufficient", () => {
    expect(parseCLIArgs(["node", "script.js"])).toBeNull();
    expect(parseCLIArgs(["node", "script.js", "kiro"])).toBeNull();
  });

  it("should return null when only --session-id is provided without agent/prompt", () => {
    expect(
      parseCLIArgs(["node", "script.js", "--session-id", "sess-123"]),
    ).toBeNull();
  });

  it("should return null when --session-id has no value (value treated as agent)", () => {
    // "--session-id" has no value after it, "kiro" is treated as agent, missing prompt
    const result = parseCLIArgs([
      "node", "script.js", "--session-id", "kiro",
    ]);

    expect(result).toBeNull();
  });
});
