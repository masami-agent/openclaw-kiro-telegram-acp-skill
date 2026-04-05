import { describe, it, expect } from "vitest";
import { getKiroSessionId, getIsolationLimitations } from "../session-isolator.js";

describe("Session Isolator", () => {
  // --- getKiroSessionId ---
  describe("getKiroSessionId()", () => {
    it("same chatId should produce the same session ID", () => {
      const chatId = "12345678";
      const id1 = getKiroSessionId(chatId);
      const id2 = getKiroSessionId(chatId);

      expect(id1).toBe(id2);
    });

    it("different chatIds should produce different session IDs", () => {
      const id1 = getKiroSessionId("11111111");
      const id2 = getKiroSessionId("22222222");

      expect(id1).not.toBe(id2);
    });

    it("session ID format should be kiro-telegram-{chatId}", () => {
      const chatId = "99887766";
      const sessionId = getKiroSessionId(chatId);

      expect(sessionId).toBe(`kiro-telegram-${chatId}`);
    });

    it("should correctly handle numeric string chatId", () => {
      const sessionId = getKiroSessionId("42");
      expect(sessionId).toBe("kiro-telegram-42");
    });

    it("session ID namespace should differ from the main agent session key", () => {
      const chatId = "12345678";
      const kiroSessionId = getKiroSessionId(chatId);
      const mainAgentSessionKey = `agent:main:telegram:direct:${chatId}`;

      expect(kiroSessionId).not.toBe(mainAgentSessionKey);
      expect(kiroSessionId.startsWith("kiro-telegram-")).toBe(true);
    });
  });

  // --- getIsolationLimitations ---
  describe("getIsolationLimitations()", () => {
    it("should return a non-empty limitations array", () => {
      const limitations = getIsolationLimitations();

      expect(Array.isArray(limitations)).toBe(true);
      expect(limitations.length).toBeGreaterThan(0);
    });

    it("each limitation should be a non-empty string", () => {
      const limitations = getIsolationLimitations();

      for (const limitation of limitations) {
        expect(typeof limitation).toBe("string");
        expect(limitation.length).toBeGreaterThan(0);
      }
    });

    it("should mention hook mechanism limitations", () => {
      const limitations = getIsolationLimitations();
      const combined = limitations.join(" ");

      expect(combined).toContain("hook");
    });

    it("should mention SOUL.md alternative", () => {
      const limitations = getIsolationLimitations();
      const combined = limitations.join(" ");

      expect(combined).toContain("SOUL.md");
    });
  });
});
