/**
 * scripts/install.ts — 互動式自動化安裝腳本
 *
 * 依序執行以下步驟，任一步驟失敗時停止並輸出已完成步驟與失敗原因：
 *   1. 檢查 openclaw CLI
 *   2. 檢查 kiro-cli（kiro --version），若未找到立即停止
 *   3. 檢查 Node.js ≥ 18
 *   4. npm install
 *   5. 引導 .env 設定
 *   6. npm run build
 *   7. 部署 hook 至 ~/.openclaw/workspace/hooks/
 *   8. 產生 agent config JSON
 *   9. 輸出安裝摘要
 *
 * 對應需求: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── 常數 ──────────────────────────────────────────────────────

// 編譯後位於 dist/scripts/install.js，需往上兩層才是專案根目錄
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");
const HOOKS_DIR = join(homedir(), ".openclaw", "workspace", "hooks");
const HOOK_SOURCE = join(PROJECT_ROOT, "dist", "src", "hook", "handler.js");

/** kiro-cli 的可能指令名稱（依優先順序嘗試） */
const KIRO_COMMANDS = ["kiro", "kiro-cli"];

/** kiro-cli 可能的安裝路徑（PATH 找不到時的 fallback） */
const KIRO_FALLBACK_PATHS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".kiro", "bin"),
  "/usr/local/bin",
];
const AGENT_TEMPLATE = join(PROJECT_ROOT, "templates", "kiro-agent.json");
const ENV_EXAMPLE = join(PROJECT_ROOT, ".env.example");
const ENV_FILE = join(PROJECT_ROOT, ".env");

// ── 工具函式 ──────────────────────────────────────────────────

interface StepResult {
  name: string;
  success: boolean;
  message: string;
}

const completedSteps: StepResult[] = [];

function recordStep(name: string, success: boolean, message: string): void {
  completedSteps.push({ name, success, message });
}

function printSummaryAndExit(failedStep: string, reason: string): never {
  console.error("");
  console.error("═══════════════════════════════════════════════");
  console.error("  安裝失敗");
  console.error("═══════════════════════════════════════════════");
  console.error("");
  console.error("已完成步驟：");
  for (const step of completedSteps) {
    const icon = step.success ? "✓" : "✗";
    console.error(`  ${icon} ${step.name}: ${step.message}`);
  }
  console.error("");
  console.error(`✗ 失敗步驟：${failedStep}`);
  console.error(`  原因：${reason}`);
  console.error("");
  process.exit(1);
}


/** 建立 readline 介面用於互動式輸入 */
function createRl(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** 提示使用者輸入，支援預設值 */
async function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue != null ? ` (預設: ${defaultValue})` : "";
  return new Promise<string>((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed.length > 0 ? trimmed : (defaultValue ?? ""));
    });
  });
}

/** 嘗試執行外部指令，回傳 stdout 或 null（失敗時） */
async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** 在 Windows 上使用 where，其他平台使用 which 來檢查指令是否存在 */
async function commandExists(cmd: string): Promise<boolean> {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const result = await tryExec(whichCmd, [cmd]);
  return result !== null;
}

// ── 安裝步驟 ──────────────────────────────────────────────────

/** 步驟 1：檢查 openclaw CLI */
async function checkOpenClaw(): Promise<void> {
  const stepName = "檢查 openclaw CLI";
  console.log("\n🔍 步驟 1：檢查 openclaw CLI ...");

  const exists = await commandExists("openclaw");
  if (!exists) {
    recordStep(stepName, false, "找不到 openclaw 指令");
    printSummaryAndExit(stepName, "找不到 openclaw 指令。請先安裝 OpenClaw CLI，再重新執行本安裝腳本。");
  }

  const version = await tryExec("openclaw", ["--version"]);
  if (version === null) {
    recordStep(stepName, false, "openclaw 指令無法正常執行");
    printSummaryAndExit(stepName, "openclaw 指令存在但無法正常執行。請確認安裝是否完整。");
  }

  console.log(`  ✓ openclaw 已安裝 (${version})`);
  recordStep(stepName, true, `版本 ${version}`);
}


/** 步驟 2：檢查 kiro-cli（最關鍵，失敗立即停止） */
async function checkKiroCli(): Promise<void> {
  const stepName = "檢查 kiro-cli";
  console.log("\n🔍 步驟 2：檢查 kiro-cli ...");

  // 嘗試多個可能的指令名稱（kiro 或 kiro-cli）
  for (const cmd of KIRO_COMMANDS) {
    const version = await tryExec(cmd, ["--version"]);
    if (version !== null) {
      console.log(`  ✓ kiro-cli 已安裝 — ${cmd} (${version})`);
      recordStep(stepName, true, `${cmd} 版本 ${version}`);
      return;
    }
  }

  // PATH 找不到時，嘗試常見安裝路徑
  for (const dir of KIRO_FALLBACK_PATHS) {
    for (const cmd of KIRO_COMMANDS) {
      const fullPath = join(dir, cmd);
      if (existsSync(fullPath)) {
        const version = await tryExec(fullPath, ["--version"]);
        if (version !== null) {
          console.log(`  ✓ kiro-cli 已安裝 — ${fullPath} (${version})`);
          console.log(`  ⚠️  注意：${dir} 不在 PATH 中，建議加入 PATH 環境變數`);
          recordStep(stepName, true, `${cmd} 版本 ${version}（位於 ${dir}）`);
          return;
        }
      }
    }
  }

  recordStep(stepName, false, "找不到 kiro / kiro-cli 指令");
  console.error(`
✗ 找不到 kiro 或 kiro-cli 指令。
  本 skill 的 ACP bridge 需要 kiro-cli 才能連線至 Kiro agent。
  請先安裝 Kiro：https://kiro.dev/docs/installation
  安裝完成後，請確認 \`kiro --version\` 或 \`kiro-cli --version\` 可正常執行，再重新執行本安裝腳本。
`);
  process.exit(1);
}

/** 步驟 3：檢查 Node.js ≥ 18 */
async function checkNodeVersion(): Promise<void> {
  const stepName = "檢查 Node.js 版本";
  console.log("\n🔍 步驟 3：檢查 Node.js 版本 ...");

  const rawVersion = process.version; // e.g. "v20.11.0"
  const major = parseInt(rawVersion.slice(1).split(".")[0], 10);

  if (major < 18) {
    recordStep(stepName, false, `目前版本 ${rawVersion}，需要 ≥ 18`);
    printSummaryAndExit(stepName, `Node.js 版本 ${rawVersion} 不符合需求。請升級至 Node.js 18 或以上版本。`);
  }

  console.log(`  ✓ Node.js ${rawVersion} (≥ 18)`);
  recordStep(stepName, true, rawVersion);
}

/** 步驟 4：npm install */
async function runNpmInstall(): Promise<void> {
  const stepName = "npm install";
  console.log("\n📦 步驟 4：執行 npm install ...");

  try {
    await execFileAsync("npm", ["install"], { cwd: PROJECT_ROOT, timeout: 120_000 });
    console.log("  ✓ 依賴安裝完成");
    recordStep(stepName, true, "依賴安裝完成");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `npm install 失敗：${message}`);
  }
}


/** 步驟 5：引導 .env 設定 */
async function setupEnv(): Promise<void> {
  const stepName = "設定 .env";
  console.log("\n⚙️  步驟 5：設定環境變數 ...");

  // 若 .env 已存在，詢問是否覆寫
  if (existsSync(ENV_FILE)) {
    const rl = createRl();
    const overwrite = await prompt(rl, "  .env 檔案已存在，是否重新設定？(y/N)", "N");
    rl.close();
    if (overwrite.toLowerCase() !== "y") {
      console.log("  ✓ 保留現有 .env 設定");
      recordStep(stepName, true, "保留現有 .env");
      return;
    }
  }

  const rl = createRl();

  console.log("  請依提示輸入環境變數值（按 Enter 使用預設值）：\n");

  const agentName = await prompt(rl, "  KIRO_AGENT_NAME — Kiro agent 名稱", "kiro");
  const timeoutMs = await prompt(rl, "  KIRO_TIMEOUT_MS — ACP 請求逾時（毫秒）", "120000");
  const wrapperCmd = await prompt(rl, "  KIRO_WRAPPER_CMD — ACP Wrapper 指令", "kiro-acp-ask");
  const chatIds = await prompt(rl, "  ALLOWED_CHAT_IDS — 允許的 chat ID（逗號分隔，空=不限制）", "");
  const replyPrefix = await prompt(rl, "  KIRO_REPLY_PREFIX — 回覆前綴", "🤖 Kiro");
  const debug = await prompt(rl, "  KIRO_DEBUG — 除錯模式 (true/false)", "false");

  rl.close();

  const envContent = `# openclaw-kiro-telegram-acp skill — 環境變數設定
# 由安裝腳本自動產生

KIRO_AGENT_NAME=${agentName}
KIRO_TIMEOUT_MS=${timeoutMs}
KIRO_WRAPPER_CMD=${wrapperCmd}
ALLOWED_CHAT_IDS=${chatIds}
KIRO_REPLY_PREFIX=${replyPrefix}
KIRO_DEBUG=${debug}
`;

  try {
    writeFileSync(ENV_FILE, envContent, "utf-8");
    console.log("\n  ✓ .env 檔案已建立");
    recordStep(stepName, true, ".env 已建立");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `無法寫入 .env 檔案：${message}`);
  }
}

/** 步驟 6：npm run build */
async function runBuild(): Promise<void> {
  const stepName = "npm run build";
  console.log("\n🔨 步驟 6：編譯 TypeScript ...");

  try {
    await execFileAsync("npm", ["run", "build"], { cwd: PROJECT_ROOT, timeout: 60_000 });
    console.log("  ✓ 編譯完成");
    recordStep(stepName, true, "編譯完成");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `npm run build 失敗：${message}`);
  }
}


/** 步驟 7：部署 hook 至 ~/.openclaw/workspace/hooks/ */
async function deployHook(): Promise<void> {
  const stepName = "部署 hook";
  console.log("\n🚀 步驟 7：部署 hook ...");

  if (!existsSync(HOOK_SOURCE)) {
    recordStep(stepName, false, "找不到編譯後的 hook 檔案");
    printSummaryAndExit(stepName, `找不到編譯後的 hook 檔案：${HOOK_SOURCE}。請確認 npm run build 已成功執行。`);
  }

  try {
    mkdirSync(HOOKS_DIR, { recursive: true });
    const dest = join(HOOKS_DIR, "kiro-telegram-handler.js");
    copyFileSync(HOOK_SOURCE, dest);
    console.log(`  ✓ hook 已部署至 ${dest}`);
    recordStep(stepName, true, `已部署至 ${HOOKS_DIR}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `部署 hook 失敗：${message}`);
  }
}

/** 步驟 8：產生 agent config JSON */
async function generateAgentConfig(): Promise<void> {
  const stepName = "產生 agent config";
  console.log("\n📝 步驟 8：產生 agent config ...");

  try {
    let templateContent: string;
    if (existsSync(AGENT_TEMPLATE)) {
      templateContent = readFileSync(AGENT_TEMPLATE, "utf-8");
    } else {
      // 使用內建預設範本
      templateContent = JSON.stringify({
        name: "kiro",
        description: "Kiro agent for Telegram relay",
        prompt: "You are a helpful assistant.",
        resources: ["./templates/kb-example.md"],
        useLegacyMcpJson: true,
      }, null, 2);
    }

    const config = JSON.parse(templateContent);

    // 若 .env 已設定 agent name，同步更新 config
    const envAgentName = readEnvValue("KIRO_AGENT_NAME");
    if (envAgentName) {
      config.name = envAgentName;
    }

    const agentDir = join(homedir(), ".openclaw", "workspace", "agents");
    mkdirSync(agentDir, { recursive: true });

    const agentName = config.name ?? "kiro";
    const dest = join(agentDir, `${agentName}.json`);
    writeFileSync(dest, JSON.stringify(config, null, 2) + "\n", "utf-8");

    console.log(`  ✓ agent config 已產生至 ${dest}`);
    recordStep(stepName, true, `已產生至 ${dest}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `產生 agent config 失敗：${message}`);
  }
}

/** 從 .env 檔案讀取指定變數值 */
function readEnvValue(key: string): string | undefined {
  if (!existsSync(ENV_FILE)) return undefined;
  try {
    const content = readFileSync(ENV_FILE, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const eqIndex = trimmed.indexOf("=");
      const k = trimmed.slice(0, eqIndex).trim();
      const v = trimmed.slice(eqIndex + 1).trim();
      if (k === key && v.length > 0) return v;
    }
  } catch {
    // ignore
  }
  return undefined;
}


/** 步驟 9：輸出安裝摘要 */
function printInstallSummary(): void {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  ✅ 安裝完成！");
  console.log("═══════════════════════════════════════════════");
  console.log("");
  console.log("已完成步驟：");
  for (const step of completedSteps) {
    console.log(`  ✓ ${step.name}: ${step.message}`);
  }
  console.log("");
  console.log("下一步操作：");
  console.log("  1. 完成 ACP device pairing：");
  console.log("     openclaw acp pair");
  console.log("  2. 驗證安裝狀態：");
  console.log("     npm run validate");
  console.log("  3. 在 Telegram 中測試：");
  console.log("     發送 /kiro 你好");
  console.log("");
  console.log("詳細說明請參閱 INSTALL.md");
  console.log("");
}

// ── 主流程 ────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  openclaw-kiro-telegram-acp skill 安裝程式");
  console.log("═══════════════════════════════════════════════");

  await checkOpenClaw();
  await checkKiroCli();
  await checkNodeVersion();
  await runNpmInstall();
  await setupEnv();
  await runBuild();
  await deployHook();
  await generateAgentConfig();
  printInstallSummary();
}

main().catch((err) => {
  console.error("\n❌ 安裝過程發生未預期的錯誤：", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
