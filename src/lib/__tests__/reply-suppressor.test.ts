import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markSession, shouldCancel, getRecentLogs } from "../reply-suppressor.js";

describe("Reply Suppressor", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // 使用 fake timers 控制時間
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- markSession → shouldCancel 正常流程 ---
  describe("markSession() → shouldCancel() 正常流程", () => {
    it("標記後 shouldCancel 應回傳 true", () => {
      const key = "test-session-1";
      markSession(key);
      expect(shouldCancel(key)).toBe(true);
    });

    it("未標記的 session shouldCancel 應回傳 false", () => {
      expect(shouldCancel("non-existent-session")).toBe(false);
    });

    it("markSession 應為同步操作（不回傳 Promise）", () => {
      const result = markSession("sync-test");
      expect(result).toBeUndefined();
    });
  });

  // --- TTL 過期 ---
  describe("TTL 過期行為", () => {
    it("TTL 30 秒過期後 shouldCancel 應回傳 false", () => {
      const key = "ttl-test-session";
      markSession(key);

      // 前進 30 秒（TTL 邊界）
      vi.advanceTimersByTime(30_000);

      expect(shouldCancel(key)).toBe(false);
    });

    it("TTL 未過期時 shouldCancel 應回傳 true", () => {
      const key = "ttl-not-expired";
      markSession(key);

      // 前進 29 秒（未過期）
      vi.advanceTimersByTime(29_999);

      expect(shouldCancel(key)).toBe(true);
    });
  });

  // --- 消費後標記清除 ---
  describe("shouldCancel 消費後標記清除", () => {
    it("shouldCancel 消費後再次呼叫應回傳 false", () => {
      const key = "consume-test";
      markSession(key);

      // 第一次消費
      expect(shouldCancel(key)).toBe(true);
      // 第二次應回傳 false（已被消費）
      expect(shouldCancel(key)).toBe(false);
    });
  });

  // --- 多 session 獨立性 ---
  describe("多 session 獨立性", () => {
    it("不同 session key 應互不影響", () => {
      markSession("session-a");
      markSession("session-b");

      expect(shouldCancel("session-a")).toBe(true);
      expect(shouldCancel("session-b")).toBe(true);
      // 兩者都已消費
      expect(shouldCancel("session-a")).toBe(false);
      expect(shouldCancel("session-b")).toBe(false);
    });
  });

  // --- stderr 日誌記錄 ---
  describe("stderr 日誌記錄", () => {
    it("markSession 應記錄至 stderr", () => {
      markSession("log-test");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('marked session="log-test"'),
      );
    });

    it("shouldCancel 取消時應記錄至 stderr", () => {
      markSession("cancel-log-test");
      shouldCancel("cancel-log-test");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('cancelled session="cancel-log-test"'),
      );
    });
  });

  // --- getRecentLogs ---
  describe("getRecentLogs()", () => {
    it("應回傳最近的操作日誌", () => {
      markSession("log-a");
      markSession("log-b");
      shouldCancel("log-a");

      const recentLogs = getRecentLogs(10);
      expect(recentLogs.length).toBeGreaterThanOrEqual(3);

      const actions = recentLogs.map((l) => l.action);
      expect(actions).toContain("marked");
      expect(actions).toContain("cancelled");
    });

    it("預設回傳最多 10 筆日誌", () => {
      // 產生超過 10 筆日誌
      for (let i = 0; i < 15; i++) {
        markSession(`bulk-${i}`);
      }

      const recentLogs = getRecentLogs();
      expect(recentLogs.length).toBeLessThanOrEqual(10);
    });

    it("指定 count 應限制回傳筆數", () => {
      for (let i = 0; i < 5; i++) {
        markSession(`count-${i}`);
      }

      const recentLogs = getRecentLogs(3);
      expect(recentLogs.length).toBeLessThanOrEqual(3);
    });
  });
});
