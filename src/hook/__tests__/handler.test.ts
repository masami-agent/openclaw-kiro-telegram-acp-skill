import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { OpenClawEvent } from "../../types/index.js";

// ============================================================
// Mock 設定 — 必須在 import handler 之前完成
// ============================================================

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock fs.readFileSync（getBotToken 使用）
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
    kiroWrapperCmd: "kiro-acp-ask",
    allowedChatIds: [],
    replyPrefix: "🤖 Kiro",
    debugMode: false,
  }),
}));

// Mock global fetch（Telegram sendMessage）
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ============================================================
// Import handler 與內部函式
// ============================================================

import handler, {
  extractChatId,
  trackProviderError,
  clearProviderErrors,
} from "../handler.js";

// ============================================================
// 測試輔助
// ============================================================

/** 建立 mock OpenClawEvent */
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

/** 設定 mockExecFile 回傳成功結果 */
function mockExecFileSuccess(text: string, stderr = "") {
  // 模擬 `openclaw agent --json` 的 JSON 回覆格式
  const stdout = JSON.stringify({ result: { payloads: [{ text }] } });
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, stdout, stderr);
    },
  );
}

/** 設定 mockExecFile 回傳錯誤結果 */
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

/** 設定 fetch mock 回傳成功 */
function mockFetchSuccess() {
  mockFetch.mockResolvedValue({
    json: () => Promise.resolve({ ok: true }),
  });
}

/** 等待所有 microtask 完成 */
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

  // ── /kiro 訊息觸發 ACP Wrapper 呼叫 ──────────────────────
  describe("/kiro 訊息觸發 ACP Wrapper 呼叫", () => {
    it("應使用 execFile 呼叫 ACP Wrapper 並傳入正確參數", async () => {
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

    it("應將 ACP Wrapper 的 stdout 回覆傳送至 Telegram", async () => {
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

    it("空 prompt（僅 /kiro）應回傳 usage 訊息", async () => {
      const event = createEvent({
        context: { content: "/kiro" },
      });

      handler(event);
      await flushPromises();

      // 不應呼叫 ACP Wrapper
      expect(mockExecFile).not.toHaveBeenCalled();

      // 應傳送 usage 訊息
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.text).toContain("Usage:");
    });

    it("ACP Wrapper 錯誤時應透過 Error Formatter 處理並傳送友善訊息", async () => {
      mockExecFileError(3, "timeout after 120000ms");

      const event = createEvent();
      handler(event);
      await flushPromises();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.text).toContain("🤖 Kiro");
      expect(body.text).toContain("逾時");
    });
  });

  // ── 非 /kiro 訊息不觸發處理 ────────────────────────────────
  describe("非 /kiro 訊息不觸發處理", () => {
    it("一般訊息不應觸發 ACP Wrapper", () => {
      const event = createEvent({
        context: { content: "hello world" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("非 telegram channel 不應觸發處理", () => {
      const event = createEvent({
        context: { channelId: "discord", content: "/kiro hello" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("非 message:received 事件不應觸發處理", () => {
      const event = createEvent({ type: "connection", action: "opened" });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });

    it("非 agent:main:telegram:direct: session key 不應觸發處理", () => {
      const event = createEvent({
        sessionKey: "agent:secondary:telegram:group:999",
        context: { content: "/kiro hello" },
      });

      const result = handler(event);

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(result).toBeUndefined();
    });
  });

  // ── ALLOWED_CHAT_IDS 過濾邏輯 ──────────────────────────────
  describe("ALLOWED_CHAT_IDS 過濾邏輯", () => {
    it("allowedChatIds 為空時應允許所有 chatId", async () => {
      // 預設 config 的 allowedChatIds 為 []
      const event = createEvent({
        context: { conversationId: "telegram:99999" },
      });

      handler(event);
      await flushPromises();

      expect(mockExecFile).toHaveBeenCalledTimes(1);
    });

    it("chatId 不在 allowedChatIds 中時不應觸發處理", async () => {
      // 動態修改 config（透過 import 的 config 物件）
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

    it("chatId 在 allowedChatIds 中時應正常處理", async () => {
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

  // ── message:sending 取消邏輯 ────────────────────────────────
  describe("message:sending 取消邏輯", () => {
    it("有 pending /kiro session 時應回傳 { cancel: true }", () => {
      // 先觸發 message:received 標記 session
      const receivedEvent = createEvent();
      handler(receivedEvent);

      // 然後觸發 message:sending
      const sendingEvent = createEvent({
        action: "sending",
      });

      const result = handler(sendingEvent);
      expect(result).toEqual({ cancel: true });
    });

    it("無 pending session 時不應取消", () => {
      const sendingEvent = createEvent({
        action: "sending",
        sessionKey: "agent:main:telegram:direct:no-pending",
      });

      const result = handler(sendingEvent);
      expect(result).toBeUndefined();
    });

    it("取消後再次 sending 不應重複取消（一次性消費）", () => {
      // 標記 session
      const receivedEvent = createEvent();
      handler(receivedEvent);

      const sendingEvent = createEvent({ action: "sending" });

      // 第一次取消
      const result1 = handler(sendingEvent);
      expect(result1).toEqual({ cancel: true });

      // 第二次不應取消
      const result2 = handler(sendingEvent);
      expect(result2).toBeUndefined();
    });
  });

  // ── extractChatId ──────────────────────────────────────────
  describe("extractChatId()", () => {
    it("應移除 telegram: 前綴", () => {
      const event = createEvent({
        context: { conversationId: "telegram:12345" },
      });
      expect(extractChatId(event)).toBe("12345");
    });

    it("無前綴時應回傳原始值", () => {
      const event = createEvent({
        context: { conversationId: "67890" },
      });
      expect(extractChatId(event)).toBe("67890");
    });
  });

  // ── Provider 錯誤頻率追蹤 ──────────────────────────────────
  describe("Provider 錯誤頻率追蹤", () => {
    it("未達閾值時應回傳 false", () => {
      expect(trackProviderError("user-1")).toBe(false);
      expect(trackProviderError("user-1")).toBe(false);
    });

    it("達到 3 次閾值時應回傳 true", () => {
      trackProviderError("user-2");
      trackProviderError("user-2");
      expect(trackProviderError("user-2")).toBe(true);
    });

    it("不同 chatId 應獨立追蹤", () => {
      trackProviderError("user-a");
      trackProviderError("user-a");
      trackProviderError("user-b");

      expect(trackProviderError("user-a")).toBe(true); // 第 3 次
      expect(trackProviderError("user-b")).toBe(false); // 僅第 2 次
    });

    it("clearProviderErrors 應清除指定 chatId 的記錄", () => {
      trackProviderError("user-c");
      trackProviderError("user-c");
      clearProviderErrors("user-c");

      expect(trackProviderError("user-c")).toBe(false); // 重新計數
    });
  });
});
