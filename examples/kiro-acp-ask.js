#!/usr/bin/env node

/**
 * Minimal wrapper contract for the Telegram /kiro hook.
 *
 * Usage:
 *   kiro-acp-ask <agent> <prompt>
 *
 * This file is intentionally a stub.
 * OpenClaw 2026.4.2 exposes `openclaw acp` as a stdio ACP bridge server,
 * not a one-shot `ask` CLI. To make the Telegram relay actually runnable,
 * replace this stub with a small ACP client that:
 *
 *   1. spawns `openclaw acp` over stdio
 *   2. initializes an ACP session
 *   3. sends a prompt to the target agent/session
 *   4. collects the final assistant text
 *   5. prints only that final text to stdout
 *
 * Exit codes:
 *   0 -> success, stdout contains reply text
 *   1 -> usage/config/runtime error
 */

const [, , agent, ...promptParts] = process.argv;
const prompt = promptParts.join(" ").trim();

if (!agent || !prompt) {
  console.error("Usage: kiro-acp-ask <agent> <prompt>");
  process.exit(1);
}

console.error([
  "kiro-acp-ask is a wrapper contract stub.",
  "OpenClaw 2026.4.2 provides `openclaw acp` as a stdio bridge, not `openclaw acp ask`.",
  "Replace examples/kiro-acp-ask.js with a real ACP client implementation for your environment.",
  `Requested agent: ${agent}`,
].join("\n"));
process.exit(1);
