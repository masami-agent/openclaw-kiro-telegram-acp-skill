import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawEvent } from "../../types/index.js";

// ============================================================
// Mock setup — must be completed before importing handler
// ============================================================

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs.readFileSync (used by getBotToken)
vi.mock("node:fs", () => ({
  readFileSync: () =>
    JSON.stringify({
      channels: { telegram: { botToken: "test-bot-token-123" } },
    }),
}));

// Mock config module
vi.mock("../../lib/config.js", () => ({
  loadConfig: () => ({
    kiroAgentName: "kiro",
    kiroTimeoutMs: 120_000,
    allowedChatIds: [],
    replyPrefix: "🤖 Kiro",
    debugMode: false,
  }),
}));

// Mock global fetch (Telegram sendMessage)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ============================================================
// Import handler and internal functions
// ============================================================

import handler, {
  extractChatId,
  trackProviderError,
  clearProviderErrors,
} from "../handler.js";

// ============================================================
// Test helpers
// ============================================================

/** Create a mock OpenClawEvent */
function createEvent(overrides: Partial<OpenClawEvent> & {
  context?: Partial<OpenClawEvent["context"]>;
} = {}): OpenClawEvent {
  const { context: ctxOverrides, ...rest } = overrides;
  return {
    type: "message",
    action: "received",
    sessionKey: "agent:main:telegram:direct:12345",
    context: {
      channelId: "telegram",
      conversationId: "telegram:12345",
      content: "/kiro hello",
      ...ctxOverrides,
    },
    ...rest,
  };
}

/** Set mockExecFile to return a success result */
function mockExecFileSuccess(text: string, stderr = "") {
  // Simulate `openclaw agent --json` JSON reply format
  const stdout = JSON.stringify({ result: { payloads: [{ text }] } });
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, stdout, stderr);
    },
  );
}

/** Set mockExecFile to return an error result */
function mockExecFileError(exitCode: number, stderr: string, stdout = "") {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      const err = new Error(stderr) as Error & { status: number; killed: boolean };
      err.status = exitCode;
      err.killed = false;
      cb(err, stdout, stderr);
    },
  );
}

/** Set fetch mock to return success */
function mockFetchSuccess() {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ ok: true }),
  });
}

/** Wait for all microtasks to complete */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

// ============================================================
// Tests
// ============================================================

describe("Hook Handler", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockFetchSuccess();
    mockExecFileSuccess("Hello from Kiro!");
    clearProviderErrors();
    vi.clearAllMocks();
    // Re-apply after clearAllMocks
    mockFetchSuccess();
    mockExecFileSuccess("Hello from Kiro!");
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── /kiro message triggers agent call ───────────────
  describe("/kiro message triggers agent call", () => {
    it("should use execFile to call agent with correct arguments", async () => {
      const event = createEvent({
        context: { content: "/kiro what is TypeScript?" },
      });

      handler(event);
      await flushPromises();

      expect(mockExecFile).toHaveBeenCalledTimes(1);
      const [cmd, args] = mockExecFile.mock.calls[0]!;
      expect(cmd).toBe("openclaw");
      expect(args).toContain("agent"); // subcommand
      expect(args).toContain("--message");
      expect(args).toContain("what is TypeScript?"); // prompt
      expect(args).toContain("--session-id");
      expect(args).toContain("kiro-telegram-12345"); // session ID
      expect(args).toContain("--json");
    });

    it("should send agent stdout reply to Telegram", async () => {
      mockExecFileSuccess("This is the Kiro reply");

      const event = createEvent();
      handler(event);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toContain("api.telegram.org");
      expect(url).toContain("test-bot-token-123");

      const body = JSON.parse(opts.body);
      expect(body.chat_id).toBe("12345");
      expect(body.text).toContain("🤖 Kiro");
      expect(body.text).toContain("This is the Kiro reply");
    });

    it("empty prompt (just /kiro) should return a usage message", async () => {
      const event = createEvent({
        context: { content: "/kiro" },
      });

      handler(event);
      await flushPromises();

      // Should not call agent
      expect(mockExecFile).not.toHaveBeenCalled();

      // Should send usage message
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.text).toContain("Usage:");
    });

    it("agent error should be processed through Error Formatter and send a friendly message", async () => {
      mockExecFileError(3, "timeout after 120000ms");

      const event = createEvent();
      handler(event);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.text).toContain("🤖 Kiro");
      expect(body.text).toContain("timed out");
    });
  });

  // ── Non-/kiro messages should not trigger processing ──────
  describe("Non-/kiro messages should not trigger processing", () => {
    it("regular messages should not trigger agent", () => {
      const event = createEvent({
        context: { content: "hello world" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("non-telegram channel should not trigger processing", () => {
      const event = createEvent({
        context: { channelId: "discord", content: "/kiro hello" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("non-message:received events should not trigger processing", () => {
      const event = createEvent({ type: "connection", action: "opened" });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("non agent:main:telegram:direct: session key should not trigger processing", () => {
      const event = createEvent({
        sessionKey: "agent:secondary:telegram:group:999",
        context: { content: "/kiro hello" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  // ── ALLOWED_CHAT_IDS filtering logic ──────────────────────
  describe("ALLOWED_CHAT_IDS filtering logic", () => {
    it("empty allowedChatIds should allow all chatIds", async () => {
      // Default config has allowedChatIds as []
      const event = createEvent({
        context: { conversationId: "telegram:99999" },
      });

      handler(event);
      await flushPromises();

      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("chatId not in allowedChatIds should not trigger processing", async () => {
      // Dynamically modify config (via the imported config object)
      const { config: handlerConfig } = await import("../handler.js");
      const originalIds = [...handlerConfig.allowedChatIds];
      handlerConfig.allowedChatIds = ["allowed-1", "allowed-2"];

      try {
        const event = createEvent({
          context: { conversationId: "telegram:blocked-user" },
        });

        handler(event);
        await flushPromises();

        expect(mockExecFile).not.toHaveBeenCalled();
      } finally {
        handlerConfig.allowedChatIds = originalIds;
      }
    });

    it("chatId in allowedChatIds should be processed normally", async () => {
      const { config: handlerConfig } = await import("../handler.js");
      const originalIds = [...handlerConfig.allowedChatIds];
      handlerConfig.allowedChatIds = ["12345", "67890"];

      try {
        const event = createEvent({
          context: { conversationId: "telegram:12345" },
        });

        handler(event);
        await flushPromises();

        expect(mockExecFile).toHaveBeenCalledTimes(1);
      } finally {
        handlerConfig.allowedChatIds = originalIds;
      }
    });
  });

  // ── message:sending cancel logic ──────────────────────────
  describe("message:sending cancel logic", () => {
    it("should return { cancel: true } when there is a pending /kiro session", () => {
      // First trigger message:received to mark the session
      const receivedEvent = createEvent();
      handler(receivedEvent);

      // Then trigger message:sending
      const sendingEvent = createEvent({
        action: "sending",
      });

      const result = handler(sendingEvent);
      expect(result).toEqual({ cancel: true });
    });

    it("should not cancel when there is no pending session", () => {
      const sendingEvent = createEvent({
        action: "sending",
        sessionKey: "agent:main:telegram:direct:no-pending",
      });

      const result = handler(sendingEvent);
      expect(result).toBeUndefined();
    });

    it("should not cancel again after consumption (one-time use)", () => {
      // Mark session
      const receivedEvent = createEvent();
      handler(receivedEvent);

      const sendingEvent = createEvent({ action: "sending" });

      // First cancel
      const result1 = handler(sendingEvent);
      expect(result1).toEqual({ cancel: true });

      // Second should not cancel
      const result2 = handler(sendingEvent);
      expect(result2).toBeUndefined();
    });
  });

  // ── extractChatId ─────────────────────────────────────────
  describe("extractChatId()", () => {
    it("should remove the telegram: prefix", () => {
      const event = createEvent({
        context: { conversationId: "telegram:12345" },
      });
      expect(extractChatId(event)).toBe("12345");
    });

    it("should return the raw value when there is no prefix", () => {
      const event = createEvent({
        context: { conversationId: "67890" },
      });
      expect(extractChatId(event)).toBe("67890");
    });
  });

  // ── Provider error frequency tracking ─────────────────────
  describe("Provider error frequency tracking", () => {
    it("should return false when threshold is not reached", () => {
      expect(trackProviderError("user-1")).toBe(false);
      expect(trackProviderError("user-1")).toBe(false);
    });

    it("should return true when the threshold of 3 is reached", () => {
      trackProviderError("user-2");
      trackProviderError("user-2");
      expect(trackProviderError("user-2")).toBe(true);
    });

    it("different chatIds should be tracked independently", () => {
      trackProviderError("user-a");
      trackProviderError("user-a");
      trackProviderError("user-b");

      expect(trackProviderError("user-a")).toBe(true); // 3rd time
      expect(trackProviderError("user-b")).toBe(false); // only 2nd time
    });

    it("clearProviderErrors should clear records for the specified chatId", () => {
      trackProviderError("user-c");
      trackProviderError("user-c");
      clearProviderErrors("user-c");

      expect(trackProviderError("user-c")).toBe(false); // recount
    });
  });
});
