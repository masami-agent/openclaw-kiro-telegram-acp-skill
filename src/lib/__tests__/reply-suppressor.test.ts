import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markSession, shouldCancel, getRecentLogs } from "../reply-suppressor.js";

describe("Reply Suppressor", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Use fake timers to control time
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- markSession → shouldCancel normal flow ---
  describe("markSession() → shouldCancel() normal flow", () => {
    it("shouldCancel should return true after marking", () => {
      const key = "test-session-1";
      markSession(key);
      expect(shouldCancel(key)).toBe(true);
    });

    it("shouldCancel should return false for unmarked sessions", () => {
      expect(shouldCancel("non-existent-session")).toBe(false);
    });

    it("markSession should be a synchronous operation (does not return a Promise)", () => {
      const result = markSession("sync-test");
      expect(result).toBeUndefined();
    });
  });

  // --- TTL expiration ---
  describe("TTL expiration behavior", () => {
    it("shouldCancel should return false after 30-second TTL expires", () => {
      const key = "ttl-test-session";
      markSession(key);

      // Advance 30 seconds (TTL boundary)
      vi.advanceTimersByTime(30_000);

      expect(shouldCancel(key)).toBe(false);
    });

    it("shouldCancel should return true when TTL has not expired", () => {
      const key = "ttl-not-expired";
      markSession(key);

      // Advance 29 seconds (not expired)
      vi.advanceTimersByTime(29_999);

      expect(shouldCancel(key)).toBe(true);
    });
  });

  // --- Mark cleared after consumption ---
  describe("shouldCancel mark cleared after consumption", () => {
    it("shouldCancel should return false on second call after consumption", () => {
      const key = "consume-test";
      markSession(key);

      // First consumption
      expect(shouldCancel(key)).toBe(true);
      // Second should return false (already consumed)
      expect(shouldCancel(key)).toBe(false);
    });
  });

  // --- Multi-session independence ---
  describe("Multi-session independence", () => {
    it("different session keys should not affect each other", () => {
      markSession("session-a");
      markSession("session-b");

      expect(shouldCancel("session-a")).toBe(true);
      expect(shouldCancel("session-b")).toBe(true);
      // Both consumed
      expect(shouldCancel("session-a")).toBe(false);
      expect(shouldCancel("session-b")).toBe(false);
    });
  });

  // --- stderr logging ---
  describe("stderr logging", () => {
    it("markSession should log to stderr", () => {
      markSession("log-test");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('marked session="log-test"'),
      );
    });

    it("shouldCancel cancellation should log to stderr", () => {
      markSession("cancel-log-test");
      shouldCancel("cancel-log-test");
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('cancelled session="cancel-log-test"'),
      );
    });
  });

  // --- getRecentLogs ---
  describe("getRecentLogs()", () => {
    it("should return recent operation logs", () => {
      markSession("log-a");
      markSession("log-b");
      shouldCancel("log-a");

      const recentLogs = getRecentLogs(10);
      expect(recentLogs.length).toBeGreaterThanOrEqual(3);

      const actions = recentLogs.map((l) => l.action);
      expect(actions).toContain("marked");
      expect(actions).toContain("cancelled");
    });

    it("should return at most 10 log entries by default", () => {
      // Generate more than 10 log entries
      for (let i = 0; i < 15; i++) {
        markSession(`bulk-${i}`);
      }

      const recentLogs = getRecentLogs();
      expect(recentLogs.length).toBeLessThanOrEqual(10);
    });

    it("specifying count should limit the number of returned entries", () => {
      for (let i = 0; i < 5; i++) {
        markSession(`count-${i}`);
      }

      const recentLogs = getRecentLogs(3);
      expect(recentLogs.length).toBeLessThanOrEqual(3);
    });
  });
});
