/**
 * scripts/validate.ts — Health Checker (post-installation validation script)
 *
 * Sequentially checks the following items, providing specific fix suggestions for each failure:
 *   1. kiro-cli availability (highest priority, fundamental ACP bridge dependency)
 *   2. openclaw CLI availability
 *   3. Hook file exists and is enabled
 *   4. Agent configuration file format is correct
 *   5. ACP Wrapper is executable
 *   6. Environment variables are set
 *   7. ACP device pairing status
 *
 * Run via `npm run validate`.
 * Exit code: 0 = all passed, 1 = any item failed
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import type { CheckResult } from "../src/types/index.js";

const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────

// Compiled to dist/scripts/validate.js, need to go up two levels to reach project root
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..", "..");
const HOOKS_DIR = join(homedir(), ".openclaw", "workspace", "hooks");
const HOOK_FILE = join(HOOKS_DIR, "kiro-telegram-handler.js");
const AGENTS_DIR = join(homedir(), ".openclaw", "workspace", "agents");
const WRAPPER_DIST = join(PROJECT_ROOT, "dist", "src", "wrapper", "kiro-acp-ask.js");
const ENV_FILE = join(PROJECT_ROOT, ".env");

/** Possible kiro-cli command names (tried in priority order) */
const KIRO_COMMANDS = ["kiro", "kiro-cli"];

/** Possible kiro-cli installation paths (fallback when not found in PATH) */
const KIRO_FALLBACK_PATHS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".kiro", "bin"),
  "/usr/local/bin",
];

// ── Utility functions ─────────────────────────────────────────

/** Try executing an external command, return stdout or null on failure */
async function tryExec(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 15_000 });
    return stdout.trim();
  } catch {
    return null;
  }
}

// ── Check functions ───────────────────────────────────────────

/** 1. [Highest priority] kiro-cli availability */
async function checkKiroCli(): Promise<CheckResult> {
  const name = "kiro-cli availability";

  // Try multiple possible command names (kiro or kiro-cli)
  for (const cmd of KIRO_COMMANDS) {
    const version = await tryExec(cmd, ["--version"]);
    if (version !== null) {
      return { name, passed: true, message: `✓ ${cmd} command works properly (${version})` };
    }
  }

  // If not found in PATH, try common installation paths
  for (const dir of KIRO_FALLBACK_PATHS) {
    for (const cmd of KIRO_COMMANDS) {
      const fullPath = join(dir, cmd);
      if (existsSync(fullPath)) {
        const version = await tryExec(fullPath, ["--version"]);
        if (version !== null) {
          return {
            name,
            passed: true,
            message: `✓ ${cmd} command works properly (${version}), located in ${dir} (note: this path is not in PATH)`,
          };
        }
      }
    }
  }

  return {
    name,
    passed: false,
    message: "✗ Cannot find kiro or kiro-cli command",
    fix: [
      "This skill's openclaw acp bridge requires kiro-cli to connect to the Kiro agent.",
      "Please install Kiro first: https://kiro.dev/docs/installation",
      "After installation, confirm `kiro --version` or `kiro-cli --version` works properly.",
      "If already installed but still not found, ensure kiro's installation path is added to the PATH environment variable.",
    ].join("\n  "),
  };
}

/** 2. openclaw CLI availability */
async function checkOpenClawCli(): Promise<CheckResult> {
  const name = "openclaw CLI availability";
  const version = await tryExec("openclaw", ["--version"]);
  if (version !== null) {
    return { name, passed: true, message: `✓ openclaw command works properly (${version})` };
  }
  return {
    name,
    passed: false,
    message: "✗ Cannot find or execute openclaw command",
    fix: [
      "Please install OpenClaw CLI first.",
      "After installation, confirm `openclaw --version` works properly.",
      "If already installed but still not found, ensure openclaw's installation path is added to the PATH environment variable.",
    ].join("\n  "),
  };
}

/** 3. Hook file exists and is enabled */
async function checkHookExists(): Promise<CheckResult> {
  const name = "Hook file status";
  if (!existsSync(HOOKS_DIR)) {
    return {
      name,
      passed: false,
      message: `✗ Hooks directory does not exist: ${HOOKS_DIR}`,
      fix: [
        "Hooks directory has not been created. Run the install script:",
        "  npm run install-skill",
        "Or manually create the directory and deploy the hook file.",
      ].join("\n  "),
    };
  }
  if (!existsSync(HOOK_FILE)) {
    return {
      name,
      passed: false,
      message: `✗ Hook file does not exist: ${HOOK_FILE}`,
      fix: [
        "Hook file has not been deployed. Run the install script:",
        "  npm run install-skill",
        "Or manually run `npm run build` then copy dist/src/hook/handler.js to the above path.",
      ].join("\n  "),
    };
  }
  return { name, passed: true, message: `✓ Hook file deployed at ${HOOK_FILE}` };
}

/** 4. Agent configuration file format is correct */
async function checkAgentConfig(): Promise<CheckResult> {
  const name = "Agent config file format";

  // Try to read agent name from .env, otherwise use default
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
      // Ignore read errors, use default
    }
  }

  const agentFile = join(AGENTS_DIR, `${agentName}.json`);
  if (!existsSync(agentFile)) {
    return {
      name,
      passed: false,
      message: `✗ Agent config file does not exist: ${agentFile}`,
      fix: [
        "Agent config file has not been generated. Run the install script:",
        "  npm run install-skill",
        `Or manually copy templates/kiro-agent.json to ${AGENTS_DIR}/${agentName}.json`,
      ].join("\n  "),
    };
  }

  // Validate JSON format
  try {
    const content = readFileSync(agentFile, "utf-8");
    const config = JSON.parse(content) as Record<string, unknown>;

    // Check required fields
    const requiredFields = ["name", "description", "prompt"];
    const missingFields = requiredFields.filter((f) => !(f in config));
    if (missingFields.length > 0) {
      return {
        name,
        passed: false,
        message: `✗ Agent config file missing required fields: ${missingFields.join(", ")}`,
        fix: [
          `Please edit ${agentFile} to include the following fields:`,
          '  "name": "kiro"',
          '  "description": "..."',
          '  "prompt": "..."',
          "Refer to templates/kiro-agent.json for a template.",
        ].join("\n  "),
      };
    }

    return { name, passed: true, message: `✓ Agent config file format is correct (${agentFile})` };
  } catch {
    return {
      name,
      passed: false,
      message: `✗ Agent config file has invalid JSON format: ${agentFile}`,
      fix: [
        "The config file is not valid JSON. Please check the syntax.",
        "Refer to templates/kiro-agent.json to recreate the file.",
      ].join("\n  "),
    };
  }
}

/** 5. ACP Wrapper is executable */
async function checkWrapperExecutable(): Promise<CheckResult> {
  const name = "ACP Wrapper executable";

  if (!existsSync(WRAPPER_DIST)) {
    return {
      name,
      passed: false,
      message: `✗ ACP Wrapper compiled file does not exist: ${WRAPPER_DIST}`,
      fix: [
        "ACP Wrapper has not been compiled. Run:",
        "  npm run build",
        "After successful compilation, re-run validation.",
      ].join("\n  "),
    };
  }

  // Check if file is readable
  try {
    accessSync(WRAPPER_DIST, constants.R_OK);
  } catch {
    return {
      name,
      passed: false,
      message: `✗ ACP Wrapper file is not readable: ${WRAPPER_DIST}`,
      fix: [
        "File permissions are incorrect. Run:",
        `  chmod +r ${WRAPPER_DIST}`,
      ].join("\n  "),
    };
  }

  return { name, passed: true, message: `✓ ACP Wrapper compiled and accessible (${WRAPPER_DIST})` };
}

/** 6. Environment variables are set */
async function checkEnvVars(): Promise<CheckResult> {
  const name = "Environment variable configuration";

  if (!existsSync(ENV_FILE)) {
    return {
      name,
      passed: false,
      message: "✗ .env file does not exist",
      fix: [
        "Create the .env file from the template:",
        "  cp .env.example .env",
        "Then modify the settings as needed.",
        "Or run the install script to auto-generate: npm run install-skill",
      ].join("\n  "),
    };
  }

  // Check if .env contains basic settings
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
      "KIRO_WRAPPER_CMD",
      "KIRO_REPLY_PREFIX",
      "KIRO_DEBUG",
    ];
    const missingKeys = expectedKeys.filter((k) => !definedKeys.includes(k));

    if (missingKeys.length > 0) {
      return {
        name,
        passed: false,
        message: `✗ .env is missing the following environment variables: ${missingKeys.join(", ")}`,
        fix: [
          "Refer to .env.example to add the missing environment variables.",
          `Missing variables: ${missingKeys.join(", ")}`,
          "These variables all have defaults, but explicit configuration is recommended to avoid confusion.",
        ].join("\n  "),
      };
    }

    return { name, passed: true, message: "✓ .env file is configured with all required variables" };
  } catch {
    return {
      name,
      passed: false,
      message: "✗ Cannot read .env file",
      fix: "Please check .env file read permissions, or recreate: cp .env.example .env",
    };
  }
}

/** 7. ACP device pairing status */
async function checkAcpPairing(): Promise<CheckResult> {
  const name = "ACP device pairing";

  // First confirm openclaw is available, otherwise cannot check pairing
  const openclawAvailable = await tryExec("openclaw", ["--version"]);
  if (openclawAvailable === null) {
    return {
      name,
      passed: false,
      message: "✗ Cannot check pairing status (openclaw CLI unavailable)",
      fix: "Please install openclaw CLI first, then re-run validation.",
    };
  }

  // Try checking pairing status via openclaw acp
  const pairingResult = await tryExec("openclaw", ["acp", "status"]);
  if (pairingResult !== null) {
    // If command succeeds, check output for positive indicators
    const lower = pairingResult.toLowerCase();
    if (lower.includes("paired") || lower.includes("active") || lower.includes("connected")) {
      return { name, passed: true, message: "✓ ACP device pairing complete" };
    }
  }

  // If `openclaw acp status` is unavailable, try `openclaw acp pair --status`
  const pairStatus = await tryExec("openclaw", ["acp", "pair", "--status"]);
  if (pairStatus !== null) {
    const lower = pairStatus.toLowerCase();
    if (lower.includes("paired") || lower.includes("active") || lower.includes("approved")) {
      return { name, passed: true, message: "✓ ACP device pairing complete" };
    }
  }

  return {
    name,
    passed: false,
    message: "✗ ACP device pairing not complete or status cannot be confirmed",
    fix: [
      "Run the following command to complete device pairing:",
      "  openclaw acp pair",
      "After completion, follow the prompts to approve the device and confirm required scopes.",
      "For detailed steps, see the ACP Device Pairing section in INSTALL.md.",
    ].join("\n  "),
  };
}

// ── Main flow ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  openclaw-kiro-telegram-acp Health Checker");
  console.log("═══════════════════════════════════════════════");
  console.log("");

  const checks: Array<() => Promise<CheckResult>> = [
    checkKiroCli,
    checkOpenClawCli,
    checkHookExists,
    checkAgentConfig,
    checkWrapperExecutable,
    checkEnvVars,
    checkAcpPairing,
  ];

  const results: CheckResult[] = [];

  for (const check of checks) {
    const result = await check();
    results.push(result);

    // Output each check result
    if (result.passed) {
      console.log(`  ${result.message}`);
    } else {
      console.log(`  ${result.message}`);
      if (result.fix) {
        console.log(`    Fix suggestion:`);
        for (const line of result.fix.split("\n")) {
          console.log(`    ${line}`);
        }
      }
    }
    console.log("");
  }

  // Output summary
  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;
  const allPassed = failedCount === 0;

  console.log("───────────────────────────────────────────────");
  if (allPassed) {
    console.log(`  ✅ All passed (${passedCount}/${results.length})`);
    console.log("  All components are working properly. You can start using the /kiro command.");
  } else {
    console.log(`  ⚠️  ${failedCount} check(s) failed (${passedCount}/${results.length} passed)`);
    console.log("  Please follow the fix suggestions above, then re-run npm run validate.");
  }
  console.log("───────────────────────────────────────────────");
  console.log("");

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("\n❌ Unexpected Health Checker error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
