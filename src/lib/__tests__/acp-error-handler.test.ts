import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleAcpError } from "../acp-error-handler.js";

describe("handleAcpError()", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  // --- AccessDeniedException ---
  it("should identify AccessDeniedException and return an insufficient permissions message", () => {
    const raw = 'AccessDeniedException: User is not authorized to perform this action';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toBe("🔐 Insufficient ACP permissions. Please perform device pairing.");
    expect(result.fixSuggestions).toContain("Run `openclaw acp pair` to complete device pairing");
    expect(result.debugMessage).toBe(raw);
  });

  it("AccessDeniedException should be case-insensitive", () => {
    const raw = 'accessdeniedexception: forbidden';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("Insufficient ACP permissions");
  });

  // --- pairing required ---
  it("should identify pairing required and return a pairing-related message", () => {
    const raw = 'Error: pairing required for device xyz-123';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toBe("🔐 Device pairing required. Please refer to the installation guide.");
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
    expect(result.debugMessage).toBe(raw);
  });

  it("pairing required should be case-insensitive", () => {
    const raw = 'PAIRING REQUIRED';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("Device pairing");
  });

  // --- scope related ---
  it("should identify scope keyword and return a scope permissions message", () => {
    const raw = 'Error: insufficient scope permissions for acp:agent:invoke';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(true);
    expect(result.userMessage).toContain("scope permissions");
    expect(result.fixSuggestions.length).toBeGreaterThan(0);
  });

  it("scope keyword should match as a standalone word", () => {
    // "microscope" should not trigger scope matching
    const raw = 'Error: microscope calibration failed';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(false);
  });

  // --- Priority order ---
  it("AccessDeniedException should take priority over scope matching", () => {
    const raw = 'AccessDeniedException: scope not granted';
    const result = handleAcpError(raw);

    expect(result.userMessage).toContain("Insufficient ACP permissions");
  });

  it("pairing required should take priority over scope matching", () => {
    const raw = 'pairing required: scope verification pending';
    const result = handleAcpError(raw);

    expect(result.userMessage).toContain("Device pairing");
  });

  // --- Unrecognized errors ---
  it("unrecognized errors should return a generic ACP error message", () => {
    const raw = 'Some completely unknown ACP error occurred';
    const result = handleAcpError(raw);

    expect(result.isAcpError).toBe(false);
    expect(result.userMessage).toContain("npm run validate");
    expect(result.fixSuggestions).toContain("Run `npm run validate` for a health check");
  });

  // --- stderr logging ---
  it("should log the full raw error to stderr", () => {
    const raw = 'AccessDeniedException: test error for logging';
    handleAcpError(raw);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(raw)
    );
  });

  it("unrecognized errors should also be logged to stderr", () => {
    const raw = 'Unknown error xyz';
    handleAcpError(raw);

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining(raw)
    );
  });

  // --- Message length ---
  it("all returned userMessage lengths should be ≤ 200 characters", () => {
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
