/**
 * scripts/install.ts — Interactive automated installation script
 *
 * Executes the following steps in order; stops and outputs completed steps with failure reason if any step fails:
 *   1. Check openclaw CLI
 *   2. Check kiro-cli (kiro --version); stops immediately if not found
 *   3. Check Node.js ≥ 18
 *   4. npm install
 *   5. Guide .env setup
 *   6. npm run build
 *   7. Deploy hook to ~/.openclaw/workspace/hooks/
 *   8. Generate agent config JSON
 *   9. Output installation summary
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────

// Compiled to dist/scripts/install.js, need to go up two levels to reach project root
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");
const HOOKS_DIR = join(homedir(), ".openclaw", "workspace", "hooks");
const HOOK_SOURCE = join(PROJECT_ROOT, "dist", "src", "hook", "handler.js");

/** Possible kiro-cli command names (tried in priority order) */
const KIRO_COMMANDS = ["kiro", "kiro-cli"];

/** Possible kiro-cli installation paths (fallback when not found in PATH) */
const KIRO_FALLBACK_PATHS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".kiro", "bin"),
  "/usr/local/bin",
];
const AGENT_TEMPLATE = join(PROJECT_ROOT, "templates", "kiro-agent.json");
const ENV_EXAMPLE = join(PROJECT_ROOT, ".env.example");
const ENV_FILE = join(PROJECT_ROOT, ".env");

// ── Utility functions ─────────────────────────────────────────

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
  console.error("  Installation Failed");
  console.error("═══════════════════════════════════════════════");
  console.error("");
  console.error("Completed steps:");
  for (const step of completedSteps) {
    const icon = step.success ? "✓" : "✗";
    console.error(`  ${icon} ${step.name}: ${step.message}`);
  }
  console.error("");
  console.error(`✗ Failed step: ${failedStep}`);
  console.error(`  Reason: ${reason}`);
  console.error("");
  process.exit(1);
}


/** Create a readline interface for interactive input */
function createRl(): ReturnType<typeof createInterface> {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/** Prompt the user for input, with default value support */
async function prompt(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue != null ? ` (default: ${defaultValue})` : "";
  return new Promise<string>((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed.length > 0 ? trimmed : (defaultValue ?? ""));
    });
  });
}

/** Try executing an external command, return stdout or null on failure */
async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** Use 'where' on Windows, 'which' on other platforms to check if a command exists */
async function commandExists(cmd: string): Promise<boolean> {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const result = await tryExec(whichCmd, [cmd]);
  return result !== null;
}

// ── Installation steps ────────────────────────────────────────

/** Step 1: Check openclaw CLI */
async function checkOpenClaw(): Promise<void> {
  const stepName = "Check openclaw CLI";
  console.log("\n🔍 Step 1: Checking openclaw CLI ...");

  const exists = await commandExists("openclaw");
  if (!exists) {
    recordStep(stepName, false, "openclaw command not found");
    printSummaryAndExit(stepName, "openclaw command not found. Please install OpenClaw CLI first, then re-run this install script.");
  }

  const version = await tryExec("openclaw", ["--version"]);
  if (version === null) {
    recordStep(stepName, false, "openclaw command cannot execute properly");
    printSummaryAndExit(stepName, "openclaw command exists but cannot execute properly. Please verify the installation is complete.");
  }

  console.log(`  ✓ openclaw installed (${version})`);
  recordStep(stepName, true, `version ${version}`);
}


/** Step 2: Check kiro-cli (most critical, stops immediately on failure) */
async function checkKiroCli(): Promise<void> {
  const stepName = "Check kiro-cli";
  console.log("\n🔍 Step 2: Checking kiro-cli ...");

  // Try multiple possible command names (kiro or kiro-cli)
  for (const cmd of KIRO_COMMANDS) {
    const version = await tryExec(cmd, ["--version"]);
    if (version !== null) {
      console.log(`  ✓ kiro-cli installed — ${cmd} (${version})`);
      recordStep(stepName, true, `${cmd} version ${version}`);
      return;
    }
  }

  // If not found in PATH, try common installation paths
  for (const dir of KIRO_FALLBACK_PATHS) {
    for (const cmd of KIRO_COMMANDS) {
      const fullPath = join(dir, cmd);
      if (existsSync(fullPath)) {
        const version = await tryExec(fullPath, ["--version"]);
        if (version !== null) {
          console.log(`  ✓ kiro-cli installed — ${fullPath} (${version})`);
          console.log(`  ⚠️  Note: ${dir} is not in PATH. Consider adding it to your PATH environment variable.`);
          recordStep(stepName, true, `${cmd} version ${version} (located in ${dir})`);
          return;
        }
      }
    }
  }

  recordStep(stepName, false, "kiro / kiro-cli command not found");
  console.error(`
✗ Cannot find kiro or kiro-cli command.
  This skill's ACP bridge requires kiro-cli to connect to the Kiro agent.
  Please install Kiro first: https://kiro.dev/docs/installation
  After installation, confirm \`kiro --version\` or \`kiro-cli --version\` works, then re-run this install script.
`);
  process.exit(1);
}

/** Step 3: Check Node.js ≥ 18 */
async function checkNodeVersion(): Promise<void> {
  const stepName = "Check Node.js version";
  console.log("\n🔍 Step 3: Checking Node.js version ...");

  const rawVersion = process.version; // e.g. "v20.11.0"
  const major = parseInt(rawVersion.slice(1).split(".")[0], 10);

  if (major < 18) {
    recordStep(stepName, false, `current version ${rawVersion}, requires ≥ 18`);
    printSummaryAndExit(stepName, `Node.js version ${rawVersion} does not meet requirements. Please upgrade to Node.js 18 or above.`);
  }

  console.log(`  ✓ Node.js ${rawVersion} (≥ 18)`);
  recordStep(stepName, true, rawVersion);
}

/** Step 4: npm install */
async function runNpmInstall(): Promise<void> {
  const stepName = "npm install";
  console.log("\n📦 Step 4: Running npm install ...");

  try {
    await execFileAsync("npm", ["install"], { cwd: PROJECT_ROOT, timeout: 120_000 });
    console.log("  ✓ Dependencies installed");
    recordStep(stepName, true, "Dependencies installed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `npm install failed: ${message}`);
  }
}


/** Step 5: Guide .env setup */
async function setupEnv(): Promise<void> {
  const stepName = "Configure .env";
  console.log("\n⚙️  Step 5: Configuring environment variables ...");

  // If .env already exists, ask whether to overwrite
  if (existsSync(ENV_FILE)) {
    const rl = createRl();
    const overwrite = await prompt(rl, "  .env file already exists. Reconfigure? (y/N)", "N");
    rl.close();
    if (overwrite.toLowerCase() !== "y") {
      console.log("  ✓ Keeping existing .env configuration");
      recordStep(stepName, true, "Kept existing .env");
      return;
    }
  }

  const rl = createRl();

  console.log("  Enter environment variable values as prompted (press Enter to use defaults):\n");

  const agentName = await prompt(rl, "  KIRO_AGENT_NAME — Kiro agent name", "kiro");
  const timeoutMs = await prompt(rl, "  KIRO_TIMEOUT_MS — ACP request timeout (ms)", "120000");
  const wrapperCmd = await prompt(rl, "  KIRO_WRAPPER_CMD — ACP Wrapper command", "kiro-acp-ask");
  const chatIds = await prompt(rl, "  ALLOWED_CHAT_IDS — Allowed chat IDs (comma-separated, empty = no restrictions)", "");
  const replyPrefix = await prompt(rl, "  KIRO_REPLY_PREFIX — Reply prefix", "🤖 Kiro");
  const debug = await prompt(rl, "  KIRO_DEBUG — Debug mode (true/false)", "false");

  rl.close();

  const envContent = `# openclaw-kiro-telegram-acp skill — Environment variable configuration
# Auto-generated by the install script

KIRO_AGENT_NAME=${agentName}
KIRO_TIMEOUT_MS=${timeoutMs}
KIRO_WRAPPER_CMD=${wrapperCmd}
ALLOWED_CHAT_IDS=${chatIds}
KIRO_REPLY_PREFIX=${replyPrefix}
KIRO_DEBUG=${debug}
`;

  try {
    writeFileSync(ENV_FILE, envContent, "utf-8");
    console.log("\n  ✓ .env file created");
    recordStep(stepName, true, ".env created");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `Failed to write .env file: ${message}`);
  }
}

/** Step 6: npm run build */
async function runBuild(): Promise<void> {
  const stepName = "npm run build";
  console.log("\n🔨 Step 6: Compiling TypeScript ...");

  try {
    await execFileAsync("npm", ["run", "build"], { cwd: PROJECT_ROOT, timeout: 60_000 });
    console.log("  ✓ Compilation complete");
    recordStep(stepName, true, "Compilation complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `npm run build failed: ${message}`);
  }
}


/** Step 7: Deploy hook to ~/.openclaw/workspace/hooks/ */
async function deployHook(): Promise<void> {
  const stepName = "Deploy hook";
  console.log("\n🚀 Step 7: Deploying hook ...");

  if (!existsSync(HOOK_SOURCE)) {
    recordStep(stepName, false, "Compiled hook file not found");
    printSummaryAndExit(stepName, `Compiled hook file not found: ${HOOK_SOURCE}. Please ensure npm run build completed successfully.`);
  }

  try {
    mkdirSync(HOOKS_DIR, { recursive: true });
    const dest = join(HOOKS_DIR, "kiro-telegram-handler.js");
    copyFileSync(HOOK_SOURCE, dest);
    console.log(`  ✓ Hook deployed to ${dest}`);
    recordStep(stepName, true, `Deployed to ${HOOKS_DIR}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `Hook deployment failed: ${message}`);
  }
}

/** Step 8: Generate agent config JSON */
async function generateAgentConfig(): Promise<void> {
  const stepName = "Generate agent config";
  console.log("\n📝 Step 8: Generating agent config ...");

  try {
    let templateContent: string;
    if (existsSync(AGENT_TEMPLATE)) {
      templateContent = readFileSync(AGENT_TEMPLATE, "utf-8");
    } else {
      // Use built-in default template
      templateContent = JSON.stringify({
        name: "kiro",
        description: "Kiro agent for Telegram relay",
        prompt: "You are a helpful assistant.",
        resources: ["./templates/kb-example.md"],
        useLegacyMcpJson: true,
      }, null, 2);
    }

    const config = JSON.parse(templateContent);

    // If .env has agent name set, sync update the config
    const envAgentName = readEnvValue("KIRO_AGENT_NAME");
    if (envAgentName) {
      config.name = envAgentName;
    }

    const agentDir = join(homedir(), ".openclaw", "workspace", "agents");
    mkdirSync(agentDir, { recursive: true });

    const agentName = config.name ?? "kiro";
    const dest = join(agentDir, `${agentName}.json`);
    writeFileSync(dest, JSON.stringify(config, null, 2) + "\n", "utf-8");

    console.log(`  ✓ Agent config generated at ${dest}`);
    recordStep(stepName, true, `Generated at ${dest}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordStep(stepName, false, message);
    printSummaryAndExit(stepName, `Failed to generate agent config: ${message}`);
  }
}

/** Read a specific variable value from the .env file */
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


/** Step 9: Output installation summary */
function printInstallSummary(): void {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  ✅ Installation Complete!");
  console.log("═══════════════════════════════════════════════");
  console.log("");
  console.log("Completed steps:");
  for (const step of completedSteps) {
    console.log(`  ✓ ${step.name}: ${step.message}`);
  }
  console.log("");
  console.log("Next steps:");
  console.log("  1. Complete ACP device pairing:");
  console.log("     openclaw acp pair");
  console.log("  2. Validate installation:");
  console.log("     npm run validate");
  console.log("  3. Test in Telegram:");
  console.log("     Send /kiro hello");
  console.log("");
  console.log("For detailed instructions, see INSTALL.md");
  console.log("");
}

// ── Main flow ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  openclaw-kiro-telegram-acp skill installer");
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
  console.error("\n❌ Unexpected error during installation:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
