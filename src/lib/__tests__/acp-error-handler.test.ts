import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleAcpError } from "../acp-error-handler.js";

describe("handleAcpError()", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  // --- AccessDeniedException ---
  it("應辨識 AccessDeniedException 並回傳權限不足訊息", () => {
    const raw = 'AccessDeniedException: User is not authorized to perform this action';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toBe("🔐 ACP 權限不足，請執行 device pairing。");
    expect(result.fixSuggestions).toContain("請執行 `openclaw acp pair` 完成 device pairing");
    expect(result.debugMessage).toBe(raw);
  });

  it("AccessDeniedException 應不區分大小寫", () => {
    const raw = 'accessdeniedexception: forbidden';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("ACP 權限不足");
  });

  // --- pairing required ---
  it("應辨識 pairing required 並回傳 pairing 相關訊息", () => {
    const raw = 'Error: pairing required for device xyz-123';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toBe("🔐 需要完成 device pairing，請參閱安裝指南。");
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
    expect(result.debugMessage).toBe(raw);
  });

  it("pairing required 應不區分大小寫", () => {
    const raw = 'PAIRING REQUIRED';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("device pairing");
  });

  // --- scope 相關 ---
  it("應辨識 scope 關鍵字並回傳 scope 權限訊息", () => {
    const raw = 'Error: insufficient scope permissions for acp:agent:invoke';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("scope 權限不足");
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
  });

  it("scope 關鍵字應作為獨立單詞比對", () => {
    // "microscope" 不應觸發 scope 比對
    const raw = 'Error: microscope calibration failed';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(false);
  });

  // --- 優先順序 ---
  it("AccessDeniedException 應優先於 scope 比對", () => {
    const raw = 'AccessDeniedException: scope not granted';
    const result = handleAcpError(raw);

    expect(result.userMessage).toContain("ACP 權限不足");
  });

  it("pairing required 應優先於 scope 比對", () => {
    const raw = 'pairing required: scope verification pending';
    const result = handleAcpError(raw);

    expect(result.userMessage).toContain("device pairing");
  });

  // --- 無法辨識的錯誤 ---
  it("無法辨識的錯誤應回傳通用 ACP 錯誤訊息", () => {
    const raw = 'Some completely unknown ACP error occurred';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(false);
    expect(result.userMessage).toContain("npm run validate");
    expect(result.fixSuggestions).toContain("請執行 `npm run validate` 進行健康檢查");
  });

  // --- stderr 記錄 ---
  it("應將完整原始錯誤記錄至 stderr", () => {
    const raw = 'AccessDeniedException: test error for logging';
    handleAcpError(raw);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(raw)
    );
  });

  it("無法辨識的錯誤也應記錄至 stderr", () => {
    const raw = 'Unknown error xyz';
    handleAcpError(raw);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(raw)
    );
  });

  // --- 訊息長度 ---
  it("所有回傳的 userMessage 長度應 ≤ 200 字元", () => {
    const testCases = [
      "AccessDeniedException: test",
      "pairing required",
      "scope error",
      "unknown error",
    ];

    for (const raw of testCases) {
      const result = handleAcpError(raw);
      expect(result.userMessage.length).toBeLessThanOrEqual(200);
    }
  });
});
