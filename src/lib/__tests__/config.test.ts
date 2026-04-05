import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SkillConfig } from "../../types/index.js";

// Save original env to restore after each test
const originalEnv = { ...process.env };

// Dynamic import to ensure each test reads the latest process.env
async function importLoadConfig() {
  // Clear module cache so dotenv.config() and process.env are re-read
  vi.resetModules();
  const mod = await import("../config.js");
  return mod.loadConfig;
}

describe("loadConfig()", () => {
  beforeEach(() => {
    // Clear all related environment variables to ensure test isolation
    delete process.env.KIRO_AGENT_NAME;
    delete process.env.KIRO_TIMEOUT_MS;
    delete process.env.ALLOWED_CHAT_IDS;
    delete process.env.KIRO_REPLY_PREFIX;
    delete process.env.KIRO_DEBUG;
  });

  afterEach(() => {
    // Restore original environment variables
    process.env = { ...originalEnv };
  });

  it("should return default values for all fields (when no env vars are set)", async () => {
    const loadConfig = await importLoadConfig();
    const config: SkillConfig = loadConfig();

    expect(config.kiroAgentName).toBe("kiro");
    expect(config.kiroTimeoutMs).toBe(120000);
    expect(config.allowedChatIds).toEqual([]);
    expect(config.replyPrefix).toBe("🤖 Kiro");
    expect(config.debugMode).toBe(false);
  });

  it("should override defaults with environment variables", async () => {
    process.env.KIRO_AGENT_NAME = "my-kiro";
    process.env.KIRO_TIMEOUT_MS = "60000";
    process.env.ALLOWED_CHAT_IDS = "111,222,333";
    process.env.KIRO_REPLY_PREFIX = "🤖 MyBot";
    process.env.KIRO_DEBUG = "true";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.kiroAgentName).toBe("my-kiro");
    expect(config.kiroTimeoutMs).toBe(60000);
    expect(config.allowedChatIds).toEqual(["111", "222", "333"]);
    expect(config.replyPrefix).toBe("🤖 MyBot");
    expect(config.debugMode).toBe(true);
  });

  it("KIRO_DEBUG set to '1' should result in debugMode being true", async () => {
    process.env.KIRO_DEBUG = "1";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.debugMode).toBe(true);
  });

  it("KIRO_DEBUG set to non-true/1 value should result in debugMode being false", async () => {
    process.env.KIRO_DEBUG = "yes";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.debugMode).toBe(false);
  });

  it("ALLOWED_CHAT_IDS with whitespace should be trimmed correctly", async () => {
    process.env.ALLOWED_CHAT_IDS = " 111 , 222 , 333 ";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.allowedChatIds).toEqual(["111", "222", "333"]);
  });

  it("KIRO_TIMEOUT_MS with invalid value should throw an error", async () => {
    process.env.KIRO_TIMEOUT_MS = "not-a-number";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
    expect(() => loadConfig()).toThrow("not-a-number");
  });

  it("KIRO_TIMEOUT_MS with negative value should throw an error", async () => {
    process.env.KIRO_TIMEOUT_MS = "-5000";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
  });

  it("KIRO_TIMEOUT_MS with 0 should throw an error", async () => {
    process.env.KIRO_TIMEOUT_MS = "0";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
  });
});
