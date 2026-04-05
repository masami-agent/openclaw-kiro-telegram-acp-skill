// ============================================================
// Shared type definitions — openclaw-kiro-telegram-acp skill
// ============================================================

// --- Config ---

export interface SkillConfig {
  kiroAgentName: string; // Default: "kiro"
  kiroTimeoutMs: number; // Default: 120000
  kiroWrapperCmd: string; // Default: "kiro-acp-ask"
  allowedChatIds: string[]; // Default: [] (empty = no restrictions)
  replyPrefix: string; // Default: "🤖 Kiro"
  debugMode: boolean; // Default: false
}

// --- OpenClaw Event ---

export interface OpenClawEvent {
  type: string;
  action: string;
  sessionKey: string;
  context: {
    channelId: string;
    conversationId: string;
    content: string;
    from?: string;
  };
}

// --- JSON-RPC ---

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// --- ACP ---

export type AcpMethod =
  | "initialize"
  | "acp/createSession"
  | "acp/bindSession"
  | "acp/sendMessage"
  | "acp/getSessionHistory"
  | "shutdown";

// --- Error Handling ---

export type ErrorType =
  | "json_rpc"
  | "provider"
  | "acp_permission"
  | "timeout"
  | "connection"
  | "unknown";

export interface FormattedError {
  userMessage: string;
  debugMessage: string;
  errorType: ErrorType;
}

export interface AcpErrorResult {
  isAcpError: boolean;
  userMessage: string;
  fixSuggestions: string[];
  debugMessage: string;
}

export interface ErrorMapping {
  pattern: RegExp;
  errorType: ErrorType;
  userMessage: string;
  fixSuggestions?: string[];
}

// --- Health Check ---

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
  fix?: string;
}

export interface HealthReport {
  timestamp: string;
  checks: CheckResult[];
  allPassed: boolean;
  summary: string;
}

// --- Reply Suppressor ---

export interface SuppressionLog {
  sessionKey: string;
  timestamp: number;
  action: "marked" | "cancelled" | "cleared" | "expired";
}

export interface PendingSession {
  sessionKey: string;
  markedAt: number;
  ttlMs: number;
}

// --- Session ---

export interface KiroSessionState {
  chatId: string;
  sessionId: string; // "kiro-telegram-{chatId}"
  createdAt: number;
  lastActiveAt: number;
  isAlive: boolean;
}

// --- Error Tracker ---

export interface ErrorTracker {
  chatId: string;
  errors: number[]; // Array of error occurrence timestamps
  windowMs: number; // Tracking window (default 300000 = 5 minutes)
  threshold: number; // Threshold for triggering additional hints (default 3)
}

// --- ACP Wrapper ---

export interface AcpWrapperOptions {
  agentName: string;
  prompt: string;
  timeoutMs: number;
  sessionId?: string;
}

export interface AcpWrapperResult {
  text: string;
  sessionId: string;
}
