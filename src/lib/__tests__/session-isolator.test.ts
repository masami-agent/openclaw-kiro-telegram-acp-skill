import { describe, it, expect } from "vitest";
import { getKiroSessionId, getIsolationLimitations } from "../session-isolator.js";

describe("Session Isolator", () => {
  // --- getKiroSessionId ---
  describe("getKiroSessionId()", () => {
    it("同一 chatId 應產生相同的 session ID", () => {
      const chatId = "12345678";
      const id1 = getKiroSessionId(chatId);
      const id2 = getKiroSessionId(chatId);

      expect(id1).toBe(id2);
    });

    it("不同 chatId 應產生不同的 session ID", () => {
      const id1 = getKiroSessionId("11111111");
      const id2 = getKiroSessionId("22222222");

      expect(id1).not.toBe(id2);
    });

    it("session ID 格式應為 kiro-telegram-{chatId}", () => {
      const chatId = "99887766";
      const sessionId = getKiroSessionId(chatId);

      expect(sessionId).toBe(`kiro-telegram-${chatId}`);
    });

    it("應正確處理數字字串 chatId", () => {
      const sessionId = getKiroSessionId("42");
      expect(sessionId).toBe("kiro-telegram-42");
    });

    it("session ID 命名空間應與主 agent session key 不同", () => {
      const chatId = "12345678";
      const kiroSessionId = getKiroSessionId(chatId);
      const mainAgentSessionKey = `agent:main:telegram:direct:${chatId}`;

      expect(kiroSessionId).not.toBe(mainAgentSessionKey);
      expect(kiroSessionId.startsWith("kiro-telegram-")).toBe(true);
    });
  });

  // --- getIsolationLimitations ---
  describe("getIsolationLimitations()", () => {
    it("應回傳非空的限制陣列", () => {
      const limitations = getIsolationLimitations();

      expect(Array.isArray(limitations)).toBe(true);
      expect(limitations.length).toBeGreaterThan(0);
    });

    it("每個限制應為非空字串", () => {
      const limitations = getIsolationLimitations();

      for (const limitation of limitations) {
        expect(typeof limitation).toBe("string");
        expect(limitation.length).toBeGreaterThan(0);
      }
    });

    it("應提及 hook 機制的限制", () => {
      const limitations = getIsolationLimitations();
      const combined = limitations.join(" ");

      expect(combined).toContain("hook");
    });

    it("應提及 SOUL.md 替代方案", () => {
      const limitations = getIsolationLimitations();
      const combined = limitations.join(" ");

      expect(combined).toContain("SOUL.md");
    });
  });
});
