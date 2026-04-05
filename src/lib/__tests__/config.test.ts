import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SkillConfig } from "../../types/index.js";

// 儲存原始 env 以便每次測試後還原
const originalEnv = { ...process.env };

// 動態 import 以確保每次測試都能讀取到最新的 process.env
async function importLoadConfig() {
  // 清除模組快取，讓 dotenv.config() 與 process.env 重新讀取
  vi.resetModules();
  const mod = await import("../config.js");
  return mod.loadConfig;
}

describe("loadConfig()", () => {
  beforeEach(() => {
    // 清除所有相關環境變數，確保測試隔離
    delete process.env.KIRO_AGENT_NAME;
    delete process.env.KIRO_TIMEOUT_MS;
    delete process.env.KIRO_WRAPPER_CMD;
    delete process.env.ALLOWED_CHAT_IDS;
    delete process.env.KIRO_REPLY_PREFIX;
    delete process.env.KIRO_DEBUG;
  });

  afterEach(() => {
    // 還原原始環境變數
    process.env = { ...originalEnv };
  });

  it("應回傳所有欄位的預設值（未設定任何環境變數時）", async () => {
    const loadConfig = await importLoadConfig();
    const config: SkillConfig = loadConfig();

    expect(config.kiroAgentName).toBe("kiro");
    expect(config.kiroTimeoutMs).toBe(120000);
    expect(config.kiroWrapperCmd).toBe("kiro-acp-ask");
    expect(config.allowedChatIds).toEqual([]);
    expect(config.replyPrefix).toBe("🤖 Kiro");
    expect(config.debugMode).toBe(false);
  });

  it("應使用環境變數覆寫預設值", async () => {
    process.env.KIRO_AGENT_NAME = "my-kiro";
    process.env.KIRO_TIMEOUT_MS = "60000";
    process.env.KIRO_WRAPPER_CMD = "custom-wrapper";
    process.env.ALLOWED_CHAT_IDS = "111,222,333";
    process.env.KIRO_REPLY_PREFIX = "🤖 MyBot";
    process.env.KIRO_DEBUG = "true";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.kiroAgentName).toBe("my-kiro");
    expect(config.kiroTimeoutMs).toBe(60000);
    expect(config.kiroWrapperCmd).toBe("custom-wrapper");
    expect(config.allowedChatIds).toEqual(["111", "222", "333"]);
    expect(config.replyPrefix).toBe("🤖 MyBot");
    expect(config.debugMode).toBe(true);
  });

  it("KIRO_DEBUG 設為 '1' 時 debugMode 應為 true", async () => {
    process.env.KIRO_DEBUG = "1";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.debugMode).toBe(true);
  });

  it("KIRO_DEBUG 設為非 true/1 的值時 debugMode 應為 false", async () => {
    process.env.KIRO_DEBUG = "yes";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.debugMode).toBe(false);
  });

  it("ALLOWED_CHAT_IDS 含有空白時應正確 trim", async () => {
    process.env.ALLOWED_CHAT_IDS = " 111 , 222 , 333 ";

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.allowedChatIds).toEqual(["111", "222", "333"]);
  });

  it("KIRO_TIMEOUT_MS 為無效值時應拋出錯誤", async () => {
    process.env.KIRO_TIMEOUT_MS = "not-a-number";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
    expect(() => loadConfig()).toThrow("not-a-number");
  });

  it("KIRO_TIMEOUT_MS 為負數時應拋出錯誤", async () => {
    process.env.KIRO_TIMEOUT_MS = "-5000";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
  });

  it("KIRO_TIMEOUT_MS 為 0 時應拋出錯誤", async () => {
    process.env.KIRO_TIMEOUT_MS = "0";

    const loadConfig = await importLoadConfig();

    expect(() => loadConfig()).toThrow("KIRO_TIMEOUT_MS");
  });
});
