/**
 * scripts/validate.ts — Health Checker（安裝後驗證腳本）
 *
 * 依序檢查以下項目，每個失敗項目提供具體修復建議：
 *   1. kiro-cli 可用性（最優先，ACP bridge 根本依賴）
 *   2. openclaw CLI 可用性
 *   3. hook 檔案存在且已啟用
 *   4. agent 設定檔格式正確
 *   5. 環境變數已設定
 *   6. ACP device pairing 狀態
 *
 * 透過 `npm run validate` 執行。
 * Exit code: 0 = 全部通過, 1 = 任一項目失敗
 *
 * 對應需求: 9.1, 9.2, 9.3, 9.4
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { CheckResult } from "../src/types/index.js";

const execFileAsync = promisify(execFile);

// ── 常數 ──────────────────────────────────────────────────────

// 編譯後位於 dist/scripts/validate.js，需往上兩層才是專案根目錄
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");

/**
 * Workspace root（可用於 dev/CI 指向不同位置，避免硬編 ~/.openclaw/workspace）
 *
 * 預設：~/.openclaw/workspace
 * 覆寫：OPENCLAW_WORKSPACE=/path/to/workspace
 */
const WORKSPACE_ROOT =
  process.env.OPENCLAW_WORKSPACE?.trim() && process.env.OPENCLAW_WORKSPACE.trim().length > 0
    ? process.env.OPENCLAW_WORKSPACE.trim()
    : join(homedir(), ".openclaw", "workspace");

const HOOKS_DIR = join(WORKSPACE_ROOT, "hooks");
const HOOK_FILE = join(HOOKS_DIR, "kiro-telegram-handler.js");
const AGENTS_DIR = join(WORKSPACE_ROOT, "agents");
const ENV_FILE = join(PROJECT_ROOT, ".env");

// CLI flags
const ARGS = process.argv.slice(2);
const DEV_MODE =
  ARGS.includes("--mode=dev") ||
  ARGS.includes("--dev") ||
  ARGS.includes("--skip-install-checks") ||
  process.env.OPENCLAW_VALIDATE_MODE === "dev";

/** kiro-cli 的可能指令名稱（依優先順序嘗試） */
const KIRO_COMMANDS = ["kiro", "kiro-cli"];

/** kiro-cli 可能的安裝路徑（PATH 找不到時的 fallback） */
const KIRO_FALLBACK_PATHS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".kiro", "bin"),
  "/usr/local/bin",
];

// ── 工具函式 ──────────────────────────────────────────────────

/** 嘗試執行外部指令，回傳 stdout 或 null（失敗時） */
async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function tryExecInProject(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 10 * 60_000, cwd: PROJECT_ROOT });
    return stdout.trim();
  } catch {
    return null;
  }
}

// ── 檢查函式 ──────────────────────────────────────────────────

/** 1. [最優先] kiro-cli 可用性 */
async function checkKiroCli(): Promise<CheckResult> {
  const name = "kiro-cli 可用性";

  // 嘗試多個可能的指令名稱（kiro 或 kiro-cli）
  for (const cmd of KIRO_COMMANDS) {
    const version = await tryExec(cmd, ["--version"]);
    if (version !== null) {
      return { name, passed: true, message: `✓ ${cmd} 指令可正常執行 (${version})` };
    }
  }

  // PATH 找不到時，嘗試常見安裝路徑
  for (const dir of KIRO_FALLBACK_PATHS) {
    for (const cmd of KIRO_COMMANDS) {
      const fullPath = join(dir, cmd);
      if (existsSync(fullPath)) {
        const version = await tryExec(fullPath, ["--version"]);
        if (version !== null) {
          return {
            name,
            passed: true,
            message: `✓ ${cmd} 指令可正常執行 (${version})，位於 ${dir}（注意：此路徑不在 PATH 中）`,
          };
        }
      }
    }
  }

  return {
    name,
    passed: false,
    message: "✗ 找不到 kiro 或 kiro-cli 指令",
    fix: [
      "本 skill 的 openclaw acp bridge 需要 kiro-cli 才能連線至 Kiro agent。",
      "請先安裝 Kiro：https://kiro.dev/docs/installation",
      "安裝後確認 `kiro --version` 或 `kiro-cli --version` 可正常執行。",
      "若已安裝但仍找不到，請確認 kiro 的安裝路徑已加入 PATH 環境變數。",
    ].join("\n  "),
  };
}

/** 2. openclaw CLI 可用性 */
async function checkOpenClawCli(): Promise<CheckResult> {
  const name = "openclaw CLI 可用性";
  const version = await tryExec("openclaw", ["--version"]);
  if (version !== null) {
    return { name, passed: true, message: `✓ openclaw 指令可正常執行 (${version})` };
  }
  return {
    name,
    passed: false,
    message: "✗ 找不到 openclaw 指令或無法執行",
    fix: [
      "請先安裝 OpenClaw CLI。",
      "安裝後確認 `openclaw --version` 可正常執行。",
      "若已安裝但仍找不到，請確認 openclaw 的安裝路徑已加入 PATH 環境變數。",
    ].join("\n  "),
  };
}

/** [dev/CI] A. 專案可 build（tsc） */
async function checkProjectBuild(): Promise<CheckResult> {
  const name = "專案 build（tsc）";
  const result = await tryExecInProject("npm", ["run", "build"]);
  if (result !== null) {
    return { name, passed: true, message: "✓ npm run build 通過" };
  }
  return {
    name,
    passed: false,
    message: "✗ npm run build 失敗",
    fix: [
      "請先安裝依賴：npm ci（或 npm install）",
      "再重試：npm run build",
      "若為 CI 環境，請確認 Node 版本與 package-lock.json 一致。",
    ].join("\n  "),
  };
}

/** [dev/CI] B. 專案測試可通過 */
async function checkProjectTests(): Promise<CheckResult> {
  const name = "專案測試（vitest）";
  const result = await tryExecInProject("npm", ["test"]);
  if (result !== null) {
    return { name, passed: true, message: "✓ npm test 通過" };
  }
  return {
    name,
    passed: false,
    message: "✗ npm test 失敗",
    fix: [
      "請執行：npm test",
      "若為首次執行，請先安裝依賴：npm ci（或 npm install）。",
    ].join("\n  "),
  };
}

/** [dev/CI] C. 必要專案檔案存在（不檢查 workspace 安裝檔） */
async function checkRepoFiles(): Promise<CheckResult> {
  const name = "Repo 檔案完整性";
  const required = [
    join(PROJECT_ROOT, "package.json"),
    join(PROJECT_ROOT, "tsconfig.json"),
    join(PROJECT_ROOT, "kiro-telegram-acp.skill"),
    join(PROJECT_ROOT, "skill-src", "kiro-telegram-acp", "SKILL.md"),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length === 0) {
    return { name, passed: true, message: "✓ 必要檔案皆存在" };
  }
  return {
    name,
    passed: false,
    message: `✗ 缺少必要檔案：${missing.map((p) => p.replace(PROJECT_ROOT + "/", "")).join(", ")}`,
    fix: [
      "請確認你位於正確的 repo root。",
      "若為部分檔案未提交，請補齊後重新執行 validate。",
    ].join("\n  "),
  };
}

/** 3. hook 檔案存在且已啟用 */
async function checkHookExists(): Promise<CheckResult> {
  const name = "hook 檔案狀態";
  if (!existsSync(HOOKS_DIR)) {
    return {
      name,
      passed: false,
      message: `✗ hooks 目錄不存在：${HOOKS_DIR}`,
      fix: [
        "hooks 目錄尚未建立，請執行安裝腳本：",
        "  npm run install-skill",
        "或手動建立目錄並部署 hook 檔案。",
      ].join("\n  "),
    };
  }
  if (!existsSync(HOOK_FILE)) {
    return {
      name,
      passed: false,
      message: `✗ hook 檔案不存在：${HOOK_FILE}`,
      fix: [
        "hook 檔案尚未部署，請執行安裝腳本：",
        "  npm run install-skill",
        "或手動執行 `npm run build` 後將 dist/src/hook/handler.js 複製至上述路徑。",
      ].join("\n  "),
    };
  }
  return { name, passed: true, message: `✓ hook 檔案已部署於 ${HOOK_FILE}` };
}

/** 4. agent 設定檔格式正確 */
async function checkAgentConfig(): Promise<CheckResult> {
  const name = "agent 設定檔格式";

  // 嘗試從 .env 讀取 agent name，否則使用預設值
  let agentName = "kiro";
  if (existsSync(ENV_FILE)) {
    try {
      const envContent = readFileSync(ENV_FILE, "utf-8");
      for (const line of envContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const eqIdx = trimmed.indexOf("=");
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        if (key === "KIRO_AGENT_NAME" && val.length > 0) {
          agentName = val;
          break;
        }
      }
    } catch {
      // 忽略讀取錯誤，使用預設值
    }
  }

  const agentFile = join(AGENTS_DIR, `${agentName}.json`);
  if (!existsSync(agentFile)) {
    return {
      name,
      passed: false,
      message: `✗ agent 設定檔不存在：${agentFile}`,
      fix: [
        "agent 設定檔尚未產生，請執行安裝腳本：",
        "  npm run install-skill",
        `或手動將 templates/kiro-agent.json 複製至 ${AGENTS_DIR}/${agentName}.json`,
      ].join("\n  "),
    };
  }

  // 驗證 JSON 格式
  try {
    const content = readFileSync(agentFile, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;

    // 檢查必要欄位
    const requiredFields = ["name", "description", "prompt"];
    const missingFields = requiredFields.filter((f) => !(f in config));
    if (missingFields.length > 0) {
      return {
        name,
        passed: false,
        message: `✗ agent 設定檔缺少必要欄位：${missingFields.join(", ")}`,
        fix: [
          `請編輯 ${agentFile}，確保包含以下欄位：`,
          '  "name": "kiro"',
          '  "description": "..."',
          '  "prompt": "..."',
          "可參考 templates/kiro-agent.json 範本。",
        ].join("\n  "),
      };
    }

    return { name, passed: true, message: `✓ agent 設定檔格式正確 (${agentFile})` };
  } catch {
    return {
      name,
      passed: false,
      message: `✗ agent 設定檔 JSON 格式錯誤：${agentFile}`,
      fix: [
        "設定檔不是有效的 JSON 格式，請檢查語法。",
        "可參考 templates/kiro-agent.json 範本重新建立。",
      ].join("\n  "),
    };
  }
}

/** 6. 環境變數已設定 */
async function checkEnvVars(): Promise<CheckResult> {
  const name = "環境變數設定";

  if (!existsSync(ENV_FILE)) {
    return {
      name,
      passed: false,
      message: "✗ .env 檔案不存在",
      fix: [
        "請從範本建立 .env 檔案：",
        "  cp .env.example .env",
        "然後依需求修改設定值。",
        "或執行安裝腳本自動產生：npm run install-skill",
      ].join("\n  "),
    };
  }

  // 檢查 .env 是否包含基本設定
  try {
    const content = readFileSync(ENV_FILE, "utf-8");
    const definedKeys: string[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIdx = trimmed.indexOf("=");
      const key = trimmed.slice(0, eqIdx).trim();
      if (key.length > 0) definedKeys.push(key);
    }

    const expectedKeys = [
      "KIRO_AGENT_NAME",
      "KIRO_TIMEOUT_MS",
      "KIRO_REPLY_PREFIX",
      "KIRO_DEBUG",
    ];
    const missingKeys = expectedKeys.filter((k) => !definedKeys.includes(k));

    if (missingKeys.length > 0) {
      return {
        name,
        passed: false,
        message: `✗ .env 缺少以下環境變數：${missingKeys.join(", ")}`,
        fix: [
          "請參考 .env.example 補齊缺少的環境變數。",
          `缺少的變數：${missingKeys.join(", ")}`,
          "這些變數皆有預設值，但建議明確設定以避免混淆。",
        ].join("\n  "),
      };
    }

    return { name, passed: true, message: "✓ .env 檔案已設定且包含所有必要變數" };
  } catch {
    return {
      name,
      passed: false,
      message: "✗ 無法讀取 .env 檔案",
      fix: "請確認 .env 檔案的讀取權限，或重新建立：cp .env.example .env",
    };
  }
}

/** 7. ACP device pairing 狀態 */
async function checkAcpPairing(): Promise<CheckResult> {
  const name = "ACP device pairing";

  // 先確認 openclaw 可用，否則無法檢查 pairing
  const openclawAvailable = await tryExec("openclaw", ["--version"]);
  if (openclawAvailable === null) {
    return {
      name,
      passed: false,
      message: "✗ 無法檢查 pairing 狀態（openclaw CLI 不可用）",
      fix: "請先安裝 openclaw CLI，再重新執行驗證。",
    };
  }

  // 嘗試透過 openclaw acp 檢查 pairing 狀態
  const pairingResult = await tryExec("openclaw", ["acp", "status"]);
  if (pairingResult !== null) {
    // 若指令成功執行，檢查輸出是否包含 paired/active 等正面指標
    const lower = pairingResult.toLowerCase();
    if (lower.includes("paired") || lower.includes("active") || lower.includes("connected")) {
      return { name, passed: true, message: "✓ ACP device pairing 已完成" };
    }
  }

  // 若 `openclaw acp status` 不可用，嘗試 `openclaw acp pair --status`
  const pairStatus = await tryExec("openclaw", ["acp", "pair", "--status"]);
  if (pairStatus !== null) {
    const lower = pairStatus.toLowerCase();
    if (lower.includes("paired") || lower.includes("active") || lower.includes("approved")) {
      return { name, passed: true, message: "✓ ACP device pairing 已完成" };
    }
  }

  return {
    name,
    passed: false,
    message: "✗ ACP device pairing 未完成或無法確認狀態",
    fix: [
      "請執行以下指令完成 device pairing：",
      "  openclaw acp pair",
      "完成後依提示 approve device 並確認所需 scopes。",
      "詳細步驟請參閱 INSTALL.md 的 ACP Device Pairing 章節。",
    ].join("\n  "),
  };
}

// ── 主流程 ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  openclaw-kiro-telegram-acp Health Checker");
  console.log("═══════════════════════════════════════════════");
  console.log("");

  if (DEV_MODE) {
    console.log("  mode: dev (skip install/workspace checks)");
    console.log("  (tip) Use default mode for post-install verification in OpenClaw workspace.");
    console.log("");
  }

  const checks: Array<() => Promise<CheckResult>> = DEV_MODE
    ? [checkRepoFiles, checkProjectBuild, checkProjectTests]
    : [checkKiroCli, checkOpenClawCli, checkHookExists, checkAgentConfig, checkEnvVars, checkAcpPairing];

  const results: CheckResult[] = [];

  for (const check of checks) {
    const result = await check();
    results.push(result);

    // 輸出每個檢查結果
    if (result.passed) {
      console.log(`  ${result.message}`);
    } else {
      console.log(`  ${result.message}`);
      if (result.fix) {
        console.log(`    修復建議：`);
        for (const line of result.fix.split("\n")) {
          console.log(`    ${line}`);
        }
      }
    }
    console.log("");
  }

  // 輸出摘要
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const allPassed = failedCount === 0;

  console.log("───────────────────────────────────────────────");
  if (allPassed) {
    console.log(`  ✅ 全部通過 (${passedCount}/${results.length})`);
    console.log("  所有元件運作正常，可以開始使用 /kiro 指令。");
  } else {
    console.log(`  ⚠️  ${failedCount} 項檢查未通過 (${passedCount}/${results.length} 通過)`);
    console.log("  請依上方修復建議逐一處理後，重新執行 npm run validate。");

    if (!DEV_MODE) {
      console.log("");
      console.log("  (hint) 若你只是剛 clone repo、想做開發/跑 CI（尚未安裝到 OpenClaw workspace），可改用 dev 模式：");
      console.log("        npm run validate -- --mode=dev");
    }
  }
  console.log("───────────────────────────────────────────────");
  console.log("");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("\n❌ Health Checker 發生未預期的錯誤：", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
