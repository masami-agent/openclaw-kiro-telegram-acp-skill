#!/usr/bin/env node

/**
 * ACP Wrapper — ACP client that communicates with the `openclaw acp` bridge via stdio.
 *
 * Programmatic usage: import { acpAsk } from "./kiro-acp-ask.js"
 * CLI usage: kiro-acp-ask <agent> <prompt> [--session-id <id>]
 *
 * Exit codes:
 *   0 = success
 *   1 = usage error
 *   2 = connection failure
 *   3 = timeout
 *
 * All diagnostic messages are output to stderr; only the final reply text is output to stdout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type {
  AcpWrapperOptions,
  AcpWrapperResult,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../types/index.js";

// ============================================================
// JSON-RPC helpers (exported for testing)
// ============================================================

let _nextId = 1;

/** Reset the JSON-RPC request ID counter (for testing only). */
export function resetIdCounter(): void {
  _nextId = 1;
}

/** Build a JSON-RPC 2.0 request object. */
export function buildJsonRpcRequest(
  method: string,
  params?: Record<string, unknown>,
): JsonRpcRequest {
  const req: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: _nextId++,
    method,
  };
  if (params !== undefined) {
    req.params = params;
  }
  return req;
}

/** Serialize a JSON-RPC request to a string writable to stdin (with newline). */
export function serializeRequest(req: JsonRpcRequest): string {
  return JSON.stringify(req) + "\n";
}

/**
 * Parse all complete JSON-RPC responses from a raw buffer string.
 * Returns [parsed responses, remaining incomplete buffer].
 */
export function parseResponses(
  buffer: string,
): [JsonRpcResponse[], string] {
  const responses: JsonRpcResponse[] = [];
  let remaining = buffer;

  while (true) {
    const newlineIdx = remaining.indexOf("\n");
    if (newlineIdx === -1) break;

    const line = remaining.slice(0, newlineIdx).trim();
    remaining = remaining.slice(newlineIdx + 1);

    if (line.length === 0) continue;

    try {
      const parsed = JSON.parse(line) as JsonRpcResponse;
      if (parsed.jsonrpc === "2.0" && typeof parsed.id === "number") {
        responses.push(parsed);
      }
    } catch {
      // Non-JSON line (possibly stderr mixed in), ignore
    }
  }

  return [responses, remaining];
}

/**
 * Determine if a JSON-RPC response is a session-not-found error.
 * Used for bindSession fallback logic.
 */
export function isSessionNotFoundError(response: JsonRpcResponse): boolean {
  if (!response.error) return false;
  const msg = response.error.message?.toLowerCase() ?? "";
  const data =
    typeof response.error.data === "string"
      ? response.error.data.toLowerCase()
      : "";
  return (
    msg.includes("session not found") ||
    msg.includes("session does not exist") ||
    msg.includes("no such session") ||
    msg.includes("invalid session") ||
    data.includes("session not found") ||
    data.includes("session does not exist")
  );
}

// ============================================================
// Session setup logic (exported for testing)
// ============================================================

export interface SessionSetupResult {
  sessionId: string;
  fellBackToCreate: boolean;
}

/**
 * Generate the JSON-RPC request sequence needed for session setup.
 *
 * - If sessionId is provided → try bindSession first
 * - Otherwise → createSession directly
 *
 * Returns [request, expectedMethod], where expectedMethod is
 * "acp/bindSession" or "acp/createSession".
 */
export function buildSessionRequests(
  agentName: string,
  sessionId?: string,
): [JsonRpcRequest, "acp/bindSession" | "acp/createSession"] {
  if (sessionId) {
    const req = buildJsonRpcRequest("acp/bindSession", {
      agentName,
      sessionId,
    });
    return [req, "acp/bindSession"];
  }
  const req = buildJsonRpcRequest("acp/createSession", { agentName });
  return [req, "acp/createSession"];
}

/** Build a fallback createSession request (used when bindSession fails). */
export function buildFallbackCreateRequest(
  agentName: string,
): JsonRpcRequest {
  return buildJsonRpcRequest("acp/createSession", { agentName });
}

/**
 * Process session response and determine if fallback is needed.
 *
 * Returns:
 * - { action: "ok", sessionId } — session established successfully
 * - { action: "fallback" } — bindSession failed, need to fall back to createSession
 * - { action: "error", message } — unrecoverable error
 */
export function handleSessionResponse(
  response: JsonRpcResponse,
  method: "acp/bindSession" | "acp/createSession",
): { action: "ok"; sessionId: string } | { action: "fallback" } | { action: "error"; message: string } {
  if (response.error) {
    if (method === "acp/bindSession" && isSessionNotFoundError(response)) {
      return { action: "fallback" };
    }
    return {
      action: "error",
      message: response.error.message ?? "Unknown session error",
    };
  }

  const result = response.result as Record<string, unknown> | undefined;
  const sessionId =
    (result?.sessionId as string) ?? (result?.session_id as string) ?? "";

  if (!sessionId) {
    return { action: "error", message: "Session response missing sessionId" };
  }

  return { action: "ok", sessionId };
}

/**
 * Extract reply text from a sendMessage response.
 */
export function extractReplyText(response: JsonRpcResponse): string {
  if (response.error) {
    throw new Error(
      response.error.message ?? "sendMessage returned an error",
    );
  }
  const result = response.result as Record<string, unknown> | undefined;
  // Try multiple common field names
  const text =
    (result?.text as string) ??
    (result?.content as string) ??
    (result?.message as string) ??
    "";
  return text;
}

// ============================================================
// Core acpAsk function
// ============================================================

export async function acpAsk(
  options: AcpWrapperOptions,
): Promise<AcpWrapperResult> {
  const { agentName, prompt, timeoutMs, sessionId } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let child: ChildProcess | undefined;

  try {
    child = spawn("openclaw", ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      signal: controller.signal,
    });

    // Collect stderr for diagnostics
    let stderrBuf = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    // Set up response collection mechanism
    let stdoutBuf = "";
    const pendingResolvers = new Map<
      number,
      {
        resolve: (r: JsonRpcResponse) => void;
        reject: (e: Error) => void;
      }
    >();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const [responses, remaining] = parseResponses(stdoutBuf);
      stdoutBuf = remaining;
      for (const resp of responses) {
        const pending = pendingResolvers.get(resp.id);
        if (pending) {
          pendingResolvers.delete(resp.id);
          pending.resolve(resp);
        }
      }
    });

    const sendAndWait = (req: JsonRpcRequest): Promise<JsonRpcResponse> => {
      return new Promise<JsonRpcResponse>((resolve, reject) => {
        pendingResolvers.set(req.id, { resolve, reject });
        const data = serializeRequest(req);
        child!.stdin!.write(data, (err) => {
          if (err) {
            pendingResolvers.delete(req.id);
            reject(err);
          }
        });
      });
    };

    // Listen for child process abnormal exit
    const exitPromise = new Promise<never>((_, reject) => {
      child!.on("error", (err) => {
        reject(new Error(`ACP bridge error: ${err.message}`));
      });
      child!.on("close", (code) => {
        if (code !== 0 && code !== null) {
          reject(
            new Error(
              `ACP bridge exited with code ${code}${stderrBuf ? `: ${stderrBuf.trim()}` : ""}`,
            ),
          );
        }
      });
    });

    const raceWithExit = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([p, exitPromise]);

    // Step 1: initialize
    process.stderr.write("[acp-wrapper] Sending initialize...\n");
    const initReq = buildJsonRpcRequest("initialize", {
      protocolVersion: 1,
      capabilities: {},
      clientInfo: { name: "kiro-acp-ask", version: "0.1.0" },
    });
    const initResp = await raceWithExit(sendAndWait(initReq));
    if (initResp.error) {
      throw new Error(
        `initialize failed: ${initResp.error.message}`,
      );
    }
    process.stderr.write("[acp-wrapper] Initialized.\n");

    // Step 2: create or bind session
    let actualSessionId: string;

    const [sessionReq, sessionMethod] = buildSessionRequests(
      agentName,
      sessionId,
    );
    process.stderr.write(
      `[acp-wrapper] ${sessionMethod}${sessionId ? ` (sessionId=${sessionId})` : ""}...\n`,
    );
    const sessionResp = await raceWithExit(sendAndWait(sessionReq));
    const sessionResult = handleSessionResponse(sessionResp, sessionMethod);

    if (sessionResult.action === "ok") {
      actualSessionId = sessionResult.sessionId;
    } else if (sessionResult.action === "fallback") {
      // bindSession failed, fall back to createSession
      process.stderr.write(
        "[acp-wrapper] bindSession failed (session not found), falling back to createSession...\n",
      );
      const fallbackReq = buildFallbackCreateRequest(agentName);
      const fallbackResp = await raceWithExit(sendAndWait(fallbackReq));
      const fallbackResult = handleSessionResponse(
        fallbackResp,
        "acp/createSession",
      );
      if (fallbackResult.action === "ok") {
        actualSessionId = fallbackResult.sessionId;
      } else if (fallbackResult.action === "error") {
        throw new Error(`createSession (fallback) failed: ${fallbackResult.message}`);
      } else {
        throw new Error("Unexpected fallback result during createSession");
      }
    } else {
      throw new Error(`${sessionMethod} failed: ${sessionResult.message}`);
    }

    process.stderr.write(
      `[acp-wrapper] Session ready: ${actualSessionId}\n`,
    );

    // Step 3: sendMessage
    process.stderr.write("[acp-wrapper] Sending message...\n");
    const msgReq = buildJsonRpcRequest("acp/sendMessage", {
      sessionId: actualSessionId,
      message: { role: "user", content: prompt },
    });
    const msgResp = await raceWithExit(sendAndWait(msgReq));
    const replyText = extractReplyText(msgResp);

    process.stderr.write("[acp-wrapper] Reply received.\n");

    // Step 4: attempt graceful shutdown (don't wait for response)
    try {
      const shutdownReq = buildJsonRpcRequest("shutdown");
      child.stdin?.write(serializeRequest(shutdownReq));
      child.stdin?.end();
    } catch {
      // Shutdown failure does not affect the result
    }

    return { text: replyText, sessionId: actualSessionId };
  } catch (err: unknown) {
    // Distinguish timeout vs other errors
    if (controller.signal.aborted) {
      const timeoutErr = new Error("ACP request timed out");
      (timeoutErr as NodeJS.ErrnoException).code = "TIMEOUT";
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    // Ensure child process is cleaned up
    if (child && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  }
}

// ============================================================
// CLI entry point
// ============================================================

/** Parse CLI arguments. */
export function parseCLIArgs(
  argv: string[],
): { agentName: string; prompt: string; sessionId?: string } | null {
  // argv[0] = node, argv[1] = script path
  const args = argv.slice(2);

  if (args.length < 2) return null;

  let sessionId: string | undefined;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--session-id" && i + 1 < args.length) {
      sessionId = args[++i];
    } else {
      positional.push(args[i]!);
    }
  }

  if (positional.length < 2) return null;

  const agentName = positional[0]!;
  const prompt = positional.slice(1).join(" ").trim();

  if (!agentName || !prompt) return null;

  return { agentName, prompt, sessionId };
}

/** CLI main — only runs when executed directly. */
async function main(): Promise<void> {
  const parsed = parseCLIArgs(process.argv);

  if (!parsed) {
    process.stderr.write(
      "Usage: kiro-acp-ask <agent> <prompt> [--session-id <id>]\n",
    );
    process.exit(1);
  }

  const { agentName, prompt, sessionId } = parsed;
  const timeoutMs = parseInt(process.env.KIRO_TIMEOUT_MS ?? "120000", 10);

  try {
    const result = await acpAsk({ agentName, prompt, timeoutMs, sessionId });
    // Only output the final reply text to stdout
    process.stdout.write(result.text);
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;

    if (error.code === "TIMEOUT") {
      process.stderr.write(`[acp-wrapper] Timeout after ${timeoutMs}ms\n`);
      process.exit(3);
    }

    // Connection failure or other errors
    process.stderr.write(
      `[acp-wrapper] Error: ${error.message ?? String(err)}\n`,
    );
    process.exit(2);
  }
}

// Detect if running directly (ESM environment)
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("kiro-acp-ask.js") ||
    process.argv[1].endsWith("kiro-acp-ask.ts"));

if (isDirectRun) {
  main();
}
