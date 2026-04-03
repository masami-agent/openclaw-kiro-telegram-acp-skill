#!/usr/bin/env node

/**
 * Minimal wrapper contract for the Telegram /kiro hook.
 *
 * Usage:
 *   kiro-acp-ask <agent> <prompt>
 *
 * Replace this stub with a real ACP client implementation that speaks to
 * `openclaw acp` over stdio and prints only the final reply text to stdout.
 */

const [, , agent, ...promptParts] = process.argv;
const prompt = promptParts.join(" ").trim();

if (!agent || !prompt) {
  console.error("Usage: kiro-acp-ask <agent> <prompt>");
  process.exit(1);
}

console.error("kiro-acp-ask stub: implement an ACP client for your environment.");
process.exit(1);
