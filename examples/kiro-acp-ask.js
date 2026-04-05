#!/usr/bin/env node
/**
 * Minimal ACP wrapper for the Telegram /kiro hook.
 *
 * Usage:
 *   kiro-acp-ask <agent-name> <prompt...>
 *
 * Spawns `openclaw acp` as a stdio JSON-RPC bridge, sends an ACP
 * initialize + prompt request, collects the final assistant text,
 * and prints it to stdout.
 *
 * Exit codes:
 *   0 -> success, stdout contains reply text
 *   1 -> usage/config error
 *   2 -> ACP transport/session error
 *   3 -> timeout
 */

const { spawn } = require("child_process");

const [, , agent, ...promptParts] = process.argv;
const prompt = promptParts.join(" ").trim();

if (!agent || !prompt) {
  console.error("Usage: kiro-acp-ask <agent-name> <prompt...>");
  process.exit(1);
}

const TIMEOUT_MS = Number(process.env.KIRO_ACP_TIMEOUT_MS || 120000);
let reqId = 1;

function jsonRpcRequest(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: reqId++, method, params });
}

const child = spawn("openclaw", ["acp"], { stdio: ["pipe", "pipe", "pipe"] });

let buffer = "";
let done = false;

const timer = setTimeout(() => {
  if (!done) {
    console.error("Timeout waiting for ACP response");
    child.kill();
    process.exit(3);
  }
}, TIMEOUT_MS);

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  // Process newline-delimited JSON-RPC responses
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      handleMessage(msg);
    } catch {
      // skip non-JSON lines
    }
  }
});

child.stderr.on("data", (chunk) => {
  // Forward ACP stderr as diagnostic
  process.stderr.write(chunk);
});

child.on("close", (code) => {
  clearTimeout(timer);
  if (!done) {
    console.error(`openclaw acp exited with code ${code} before returning a result`);
    process.exit(2);
  }
});

let sessionId = null;

function handleMessage(msg) {
  if (done) return;

  // Response to initialize
  if (msg.id === 1 && msg.result) {
    sessionId = `kiro-${Date.now()}`;
    const req = jsonRpcRequest("acp/send", {
      sessionId,
      agent,
      message: { role: "user", content: prompt },
    });
    child.stdin.write(req + "\n");
    return;
  }

  // Response to acp/send — extract assistant text
  if (msg.id === 2 && msg.result) {
    const text =
      msg.result?.text ||
      msg.result?.content ||
      msg.result?.message?.content ||
      (typeof msg.result === "string" ? msg.result : null);
    if (text) {
      done = true;
      clearTimeout(timer);
      process.stdout.write(text);
      child.stdin.end();
    } else {
      done = true;
      clearTimeout(timer);
      console.error("Empty response from ACP agent");
      child.stdin.end();
      process.exit(2);
    }
    return;
  }

  // JSON-RPC error
  if (msg.error) {
    done = true;
    clearTimeout(timer);
    console.error(`ACP error: ${msg.error.message || JSON.stringify(msg.error)}`);
    child.stdin.end();
    process.exit(2);
  }
}

// Start: send initialize
child.stdin.write(jsonRpcRequest("initialize", {}) + "\n");
