import { describe, it, expect } from "vitest";
import { formatError, sanitize, ERROR_MAPPINGS } from "../error-formatter.js";

describe("formatError()", () => {
  // --- JSON-RPC errors ---
  it("should identify JSON-RPC -32603 (Internal error) and return the corresponding message", () => {
    const raw = '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error","data":"something"}}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ Internal service error. Please try again later.");
    expect(result.debugMessage).toBe(raw);
  });

  it("should identify JSON-RPC -32600 (Invalid Request) and return the corresponding message", () => {
    const raw = '{"code":-32600,"message":"Invalid Request"}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ Invalid request format. Please try again.");
  });

  it("should identify JSON-RPC -32601 (Method not found) and return the corresponding message", () => {
    const raw = '{"code":-32601,"message":"Method not found"}';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("json_rpc");
    expect(result.userMessage).toBe("⚠️ The specified service method does not exist. Please check the configuration.");
  });

  // --- Provider errors ---
  it("should identify finish_reason: error and return a provider error message", () => {
    const raw = 'Provider finish_reason: error - something went wrong';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ The AI service is temporarily unavailable. Please try again later.");
  });

  it("should identify rate_limit and return the corresponding message", () => {
    const raw = 'Error: rate_limit exceeded, please retry later';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ AI service rate limit exceeded. Please try again later.");
  });

  it("should identify context_length_exceeded and return the corresponding message", () => {
    const raw = 'Error: context_length_exceeded';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ Message too long. Please shorten it and try again.");
  });

  it("should identify model_not_found and return the corresponding message", () => {
    const raw = 'Error: model_not_found: gpt-5-turbo';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("provider");
    expect(result.userMessage).toBe("⚠️ AI model configuration error. Please contact the administrator.");
  });

  // --- ACP permission errors ---
  it("should identify AccessDeniedException and return an acp_permission error", () => {
    const raw = 'AccessDeniedException: User is not authorized';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("acp_permission");
    expect(result.userMessage).toBe("🔐 Insufficient ACP permissions. Please perform device pairing.");
  });

  it("should identify pairing required and return an acp_permission error", () => {
    const raw = 'Error: pairing required for this device';
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("acp_permission");
    expect(result.userMessage).toBe("🔐 Device pairing required. Please refer to the installation guide.");
  });

  // --- Timeout ---
  it("exit code 3 should return a timeout error (takes priority over pattern matching)", () => {
    const raw = "some random output without timeout keyword";
    const result = formatError(raw, 3);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro response timed out. Please try again later.");
  });

  it("even if rawOutput contains other error patterns, exit code 3 should still return timeout", () => {
    const raw = '{"code":-32603,"message":"Internal error"}';
    const result = formatError(raw, 3);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro response timed out. Please try again later.");
  });

  it("rawOutput containing timeout keyword should return a timeout error", () => {
    const raw = "Connection timed out after 120000ms";
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("timeout");
    expect(result.userMessage).toBe("⏱️ Kiro response timed out. Please try again later.");
  });

  // --- Unknown errors ---
  it("unrecognized errors should return a generic message", () => {
    const raw = "Something completely unexpected happened";
    const result = formatError(raw, 1);

    expect(result.errorType).toBe("unknown");
    expect(result.userMessage).toBe("⚠️ Kiro is temporarily unable to process your request. Please try again later.");
  });

  // --- Message length ---
  it("all ERROR_MAPPINGS userMessage lengths should be ≤ 200 characters", () => {
    for (const mapping of ERROR_MAPPINGS) {
      expect(mapping.userMessage.length).toBeLessThanOrEqual(200);
    }
  });

  it("formatError returned userMessage length should be ≤ 200 characters", () => {
    // Test various exit codes
    for (const exitCode of [0, 1, 2, 3]) {
      const result = formatError("any error", exitCode);
      expect(result.userMessage.length).toBeLessThanOrEqual(200);
    }
  });

  // --- debugMessage preserves raw output ---
  it("debugMessage should preserve the complete raw output", () => {
    const raw = '{"code":-32603,"message":"Internal error","data":"secret-data","request_id":"abc-123"}';
    const result = formatError(raw, 1);

    expect(result.debugMessage).toBe(raw);
  });
});

describe("sanitize()", () => {
  it("should remove request_id fields", () => {
    const input = 'Error occurred. request_id: abc-123-def, details: something';
    const result = sanitize(input);

    expect(result).not.toContain("request_id");
    expect(result).not.toContain("abc-123-def");
  });

  it("should remove JSON-formatted request_id", () => {
    const input = '{"error":"bad","request_id":"req-456","code":500}';
    const result = sanitize(input);

    expect(result).not.toContain("request_id");
    expect(result).not.toContain("req-456");
  });

  it("should remove stack trace lines", () => {
    const input = `Error: something failed
    at Object.<anonymous> (/app/src/index.ts:10:5)
    at Module._compile (node:internal/modules/cjs/loader:1234:14)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)`;
    const result = sanitize(input);

    expect(result).not.toContain("at Object.<anonymous>");
    expect(result).not.toContain("at Module._compile");
    expect(result).not.toContain("at processTicksAndRejections");
  });

  it("should remove internal endpoint URLs", () => {
    const input = "Failed to connect to https://internal-api.example.com/v1/chat endpoint";
    const result = sanitize(input);

    expect(result).not.toContain("https://internal-api.example.com/v1/chat");
    expect(result).toContain("[redacted-url]");
  });

  it("should remove http URLs", () => {
    const input = "Connecting to http://localhost:3000/api/health";
    const result = sanitize(input);

    expect(result).not.toContain("http://localhost:3000/api/health");
    expect(result).toContain("[redacted-url]");
  });

  it("should remove common Error type headers", () => {
    const input = `TypeError: Cannot read property 'foo' of undefined
    at bar (/app/src/bar.ts:5:3)`;
    const result = sanitize(input);

    expect(result).not.toContain("TypeError:");
    expect(result).not.toContain("at bar");
  });

  it("messages without sensitive information should remain unchanged", () => {
    const input = "A general error message with no sensitive info";
    const result = sanitize(input);

    expect(result).toBe(input);
  });

  it("should clean up excessive blank lines", () => {
    const input = "Line 1\n\n\n\n\nLine 2";
    const result = sanitize(input);

    expect(result).not.toMatch(/\n{3,}/);
  });
});
